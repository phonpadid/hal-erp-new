import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, DocStatus, GlPostingStatus, StockTxnType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Workflow } from '../approval/approval.entities';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Item, ItemCompany } from '../master-data/master-data.entities';
import { StockTxn, Warehouse } from '../inventory/inventory.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { GlPostingAttempt } from './gl-posting.entities';
import { createEntry, GlPostingService, SOURCE_PAYMENT, SOURCE_STOCK } from './gl-posting.service';
import { GlPostingSweeper, MAX_ATTEMPTS } from './gl-posting-sweeper.service';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';
import { JournalService } from './journal.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * What the ledger says about the postings it did not deliver.
 *
 * Before this, a posting failure was a `logger.error` and nothing else: "which postings are owed
 * and missing?" had no answer, and a posting lost to a restart produced no evidence at all.
 */
describe.skipIf(!hasDb)('GL posting attempts (DB-backed)', () => {
  let orm: MikroORM;
  let posting: GlPostingService;
  let sweeper: GlPostingSweeper;
  let journal: JournalService;
  let companyId = '';
  let budgetId = '';
  let itemId = '';
  let whId = '';
  let seq = 0;

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId, departmentId: 'd', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em), new AccountService(orm.em, scope));
    sweeper = new GlPostingSweeper(orm.em, posting);
    journal = new JournalService(scope);

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    budgetId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, FILTER_OFF)).id;
    const items = await em.find(Item, { isActive: true }, { ...FILTER_OFF, limit: 1 });
    itemId = items[0]?.id ?? '';
    // A warehouse for the stock case; the seed may not ship one, so make it deterministic here.
    const wh =
      (await em.findOne(Warehouse, { company: companyId }, FILTER_OFF)) ??
      em.create(Warehouse, {
        company: em.getReference(Company, companyId), code: 'ATT', name: 'Attempt wh', isActive: true,
      } as never);
    await em.flush();
    whId = wh.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  /** A settled document with a Payment, optionally without the ACTUAL that gives it an expense side. */
  async function settled(withActual = true): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    const doc = em.create(Document, {
      docNo: `ATT-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: '1000.00', createdAt: new Date(),
    } as never);
    await em.flush();
    if (withActual) {
      em.create(BudgetTxn, { budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL, amount: '1000.00', createdAt: new Date() } as never);
    }
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: '1000.00', baseActual: '1000.00',
      fxDelta: '0.00', fxKind: 'NONE', whtAmount: '0', paidAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  const rowFor = (sourceType: string, sourceId: string) =>
    orm.em.fork().findOne(GlPostingAttempt, { sourceType, sourceId }, FILTER_OFF);

  const dropRole = async (role: string) => {
    const em = orm.em.fork();
    await em.nativeDelete(AccountRole, { company: companyId, role }, FILTER_OFF);
  };
  const restoreRole = async (role: string, code: string) => {
    const em = orm.em.fork();
    if (await em.findOne(AccountRole, { company: companyId, role }, FILTER_OFF)) return;
    const account = await em.findOneOrFail(
      (await import('../accounting/accounting.entities')).Account,
      { company: companyId, code },
      FILTER_OFF,
    );
    em.create(AccountRole, { company: em.getReference(Company, companyId), role, account } as never);
    await em.flush();
  };

  it('refuses an unbalanced entry and writes neither header nor lines', async () => {
    // Unreachable through any posting path — all four balance by construction, which is exactly
    // why the invariant needed a check rather than an argument. Two of the four asserted nothing
    // before this constructor existed.
    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    const { Account } = await import('../accounting/accounting.entities');
    const account = await em.findOneOrFail(Account, { company: companyId, code: '5000' }, FILTER_OFF);
    const sourceId = '00000000-0000-4000-8000-0000000000aa';

    await expect(
      em.transactional(async (tem) =>
        createEntry(tem, {
          company,
          instant: new Date(),
          sourceType: 'UNBALANCED_TEST',
          sourceId,
          memo: 'deliberately lopsided',
          lines: [
            { account, debit: '100.00', credit: '0' },
            { account, debit: '0', credit: '99.00' },
          ],
        }),
      ),
    ).rejects.toThrow(/Unbalanced journal entry for UNBALANCED_TEST/);

    const fresh = orm.em.fork();
    expect(await fresh.find(JournalEntry, { sourceId }, FILTER_OFF)).toHaveLength(0);
    expect(await fresh.find(JournalLine, { memo: 'deliberately lopsided' }, FILTER_OFF)).toHaveLength(0);
  });

  it('records POSTED for a posting that produced an entry', async () => {
    const doc = await settled();
    await posting.postForPayment(doc);

    const row = await rowFor(SOURCE_PAYMENT, doc);
    expect(row?.status).toBe(GlPostingStatus.POSTED);
    expect(row?.attempts).toBe(0);
  });

  it('records SKIPPED, not FAILED, for a settlement with nothing to post', async () => {
    // A settled document that cut no budget has no expense side. That is a correct no-op — and
    // recording it terminally is what keeps it off the undelivered read forever after.
    const doc = await settled(false);
    await posting.postForPayment(doc);

    expect(await rowFor(SOURCE_PAYMENT, doc)).toMatchObject({ status: GlPostingStatus.SKIPPED });
    const { items } = await asCompany(() => journal.undelivered());
    expect(items.map((r) => r.sourceId)).not.toContain(doc);
  });

  it('records SKIPPED for a stock row that moved no value', async () => {
    const em = orm.em.fork();
    const txn = em.create(StockTxn, {
      company: em.getReference(Company, companyId), item: em.getReference(Item, itemId),
      warehouse: em.getReference(Warehouse, whId), txnType: StockTxnType.RESERVE, qty: '2',
      createdAt: new Date(),
    } as never);
    await em.flush();

    await posting.postForStockTxn(txn.id);
    expect(await rowFor(SOURCE_STOCK, txn.id)).toMatchObject({ status: GlPostingStatus.SKIPPED });
  });

  it('records FAILED with the error and leaves the payment intact', async () => {
    await dropRole('CASH_CLEARING');
    const doc = await settled();
    await expect(posting.postForPayment(doc)).rejects.toThrow(/CASH_CLEARING/);

    const row = await rowFor(SOURCE_PAYMENT, doc);
    expect(row?.status).toBe(GlPostingStatus.FAILED);
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatch(/CASH_CLEARING/);
    // The payment itself is untouched — the GL is incomplete, the money is not.
    expect(await orm.em.fork().findOne(Payment, { document: doc }, FILTER_OFF)).not.toBeNull();
    expect(await orm.em.fork().findOne(JournalEntry, { sourceId: doc }, FILTER_OFF)).toBeNull();

    await restoreRole('CASH_CLEARING', '1000');
  });

  it('lists a failed posting on the undelivered read and hides posted ones', async () => {
    await dropRole('CASH_CLEARING');
    const failing = await settled();
    await expect(posting.postForPayment(failing)).rejects.toThrow();
    await restoreRole('CASH_CLEARING', '1000');
    const posted = await settled();
    await posting.postForPayment(posted);

    const { items } = await asCompany(() => journal.undelivered({ limit: 100 }));
    const ids = items.map((r) => r.sourceId);
    expect(ids).toContain(failing);
    expect(ids).not.toContain(posted);
  });

  it('stops retrying at the attempt bound and parks the row FAILED', async () => {
    await dropRole('CASH_CLEARING');
    const doc = await settled();
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) await sweeper.sweep();

    const row = await rowFor(SOURCE_PAYMENT, doc);
    expect(row?.status).toBe(GlPostingStatus.FAILED);
    // Bounded: the sweep gave up rather than hammering the same unmappable role forever.
    expect(row?.attempts).toBe(MAX_ATTEMPTS);
    // Still owed, though — the bound stops the retrying, not the debt.
    const { items } = await asCompany(() => journal.undelivered({ limit: 100 }));
    expect(items.map((r) => r.sourceId)).toContain(doc);

    await restoreRole('CASH_CLEARING', '1000');
  });

  it('re-queues a failed posting so the fixed cause can complete it', async () => {
    await dropRole('CASH_CLEARING');
    const doc = await settled();
    for (let i = 0; i < MAX_ATTEMPTS + 1; i += 1) await sweeper.sweep();
    expect((await rowFor(SOURCE_PAYMENT, doc))?.status).toBe(GlPostingStatus.FAILED);

    // The operator maps the account that was missing, then puts the work back on the queue.
    await restoreRole('CASH_CLEARING', '1000');
    const row = (await rowFor(SOURCE_PAYMENT, doc))!;
    await asCompany(() => journal.requeue(row.id));
    await sweeper.sweep();

    expect((await rowFor(SOURCE_PAYMENT, doc))?.status).toBe(GlPostingStatus.POSTED);
    expect(await orm.em.fork().findOne(JournalEntry, { sourceId: doc, sourceType: SOURCE_PAYMENT }, FILTER_OFF)).not.toBeNull();
  });

  it('refuses to re-queue a posting that is already answered', async () => {
    const doc = await settled();
    await posting.postForPayment(doc);
    const row = (await rowFor(SOURCE_PAYMENT, doc))!;

    await expect(asCompany(() => journal.requeue(row.id))).rejects.toThrow(/only a FAILED/);
    const entries = await orm.em.fork().find(JournalEntry, { sourceId: doc, sourceType: SOURCE_PAYMENT }, FILTER_OFF);
    expect(entries).toHaveLength(1);
  });

  it('reconciles a posting that was never attempted', async () => {
    // The crash window: the payment committed and the in-process listener never ran, so there is
    // no entry, no row, no exception and no log line. Simulated by not calling the posting at all.
    const doc = await settled();
    expect(await rowFor(SOURCE_PAYMENT, doc)).toBeNull();

    const found = await sweeper.reconcile();
    expect(found).toBeGreaterThanOrEqual(1);
    expect((await rowFor(SOURCE_PAYMENT, doc))?.status).toBe(GlPostingStatus.PENDING);

    await sweeper.drain();
    expect((await rowFor(SOURCE_PAYMENT, doc))?.status).toBe(GlPostingStatus.POSTED);
  });

  it('reconciliation does not re-offer a source that already posted', async () => {
    const doc = await settled();
    await posting.postForPayment(doc);
    await sweeper.reconcile();

    // One row, still POSTED — reconciliation asks the journal first and finds its answer there.
    const rows = await orm.em.fork().find(GlPostingAttempt, { sourceType: SOURCE_PAYMENT, sourceId: doc }, FILTER_OFF);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(GlPostingStatus.POSTED);
  });

  it('two concurrent sweeps post one source exactly once', async () => {
    const doc = await settled();
    await sweeper.reconcile();

    await Promise.all([sweeper.drain(), sweeper.drain()]);

    const entries = await orm.em.fork().find(JournalEntry, { sourceType: SOURCE_PAYMENT, sourceId: doc }, FILTER_OFF);
    expect(entries).toHaveLength(1);
  });

  it('scopes the undelivered read to the active company', async () => {
    const em = orm.em.fork();
    const other = em.create(Company, {
      code: 'ATT-B', nameTh: 'B', nameEn: 'B', taxId: '77', branchCode: '00000', isActive: true, createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(GlPostingAttempt, {
      company: other, sourceType: SOURCE_PAYMENT, sourceId: '00000000-0000-4000-8000-0000000000ff',
      status: GlPostingStatus.FAILED, attempts: MAX_ATTEMPTS, lastError: 'other company', createdAt: new Date(),
    } as never);
    await em.flush();

    const { items } = await asCompany(() => journal.undelivered({ limit: 100 }));
    expect(items.map((r) => r.sourceId)).not.toContain('00000000-0000-4000-8000-0000000000ff');

    // …and the same scope guards the write: another company's row cannot be re-queued from here.
    const foreign = await orm.em.fork().findOneOrFail(
      GlPostingAttempt,
      { sourceId: '00000000-0000-4000-8000-0000000000ff' },
      FILTER_OFF,
    );
    await expect(asCompany(() => journal.requeue(foreign.id))).rejects.toThrow(/not found/i);
  });
});
