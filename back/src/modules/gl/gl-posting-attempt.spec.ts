import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { localDateIn } from '../../common/time/company-clock';
import { AccountRoleType, BudgetTxnType, DocStatus, GlPostingStatus, StockTxnType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
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

// Fixtures write budget rows directly; `budget_txn.txn_date` is the day of the event and is
// not nullable, so a fixture must state one just as the ledger service does.
const TODAY = new Date().toISOString().slice(0, 10);

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
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em), new AccountService(orm.em, scope), new PeriodGuardService());
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
      em.create(BudgetTxn, { budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL, txnDate: TODAY, amount: '1000.00', createdAt: new Date() } as never);
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
        }, new PeriodGuardService()),
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

  it('lists an accrued, unpaid purchase as an open payable and drops it once paid', async () => {
    const em = orm.em.fork();
    const apRole = await em.findOneOrFail(
      (await import('./gl.entities')).AccountRole,
      { company: companyId, role: 'ACCOUNTS_PAYABLE' },
      { ...FILTER_OFF, populate: ['account'] },
    );
    const vendor = em.create(
      (await import('../master-data/master-data.entities')).Vendor,
      { vendorCode: `V-OP-${++seq}`, name: 'Payable vendor', paymentTermDays: 30, isActive: true } as never,
    );
    await em.flush();

    const doc = await settled();
    const em2 = orm.em.fork();
    const d = await em2.findOneOrFail(Document, { id: doc }, FILTER_OFF);
    d.vendor = em2.getReference((await import('../master-data/master-data.entities')).Vendor, vendor.id);
    // The accrual, written directly: this asserts the READ, and how the entry was produced is the
    // accrual path's own test.
    const accrual = em2.create(JournalEntry, {
      company: em2.getReference(Company, companyId), entryDate: '2026-08-01',
      sourceType: 'APPROVAL_ACCRUAL', sourceId: doc, memo: 'accrual', createdAt: new Date(),
    } as never);
    await em2.flush();
    em2.create((await import('./gl.entities')).JournalLine, {
      company: em2.getReference(Company, companyId), journalEntry: accrual,
      account: apRole.account, debit: '0', credit: '1000.00',
    } as never);
    await em2.flush();

    const open = await asCompany(() => journal.openPayables());
    const row = open.items.find((r) => r.documentId === doc);
    expect(row).toBeDefined();
    expect(row!.vendorName).toBe('Payable vendor');
    expect(Number(row!.amount)).toBe(1000);
    expect(row!.invoiceDate).toBe('2026-08-01');
    expect(row!.dueDate).toBe('2026-08-31'); // 30 days from the vendor's terms
    // Aged against the COMPANY's day, on the server. Asserted as a RELATIONSHIP rather than a
    // fixed bucket: this fixture's dates are absolute, so pinning a band here would make the test
    // change its answer as the calendar moves. The dedicated ageing cases below build their due
    // dates relative to the company day instead.
    expect(row!.bucket === 'NOT_DUE').toBe(row!.daysOverdue === 0);

    // Paying it closes the item — no state to update, the payment entry IS the closure.
    await posting.postForPayment(doc);
    const after = await asCompany(() => journal.openPayables());
    expect(after.items.map((r) => r.documentId)).not.toContain(doc);
  });

  it('does not list a claim as an open payable', async () => {
    // A claim accrues to CLAIM_PAYABLE: owed to a person, cleared by a recorded settlement.
    const em = orm.em.fork();
    const claimPayable = em.create(
      (await import('../accounting/accounting.entities')).Account,
      { company: em.getReference(Company, companyId), code: '2131', name: 'Claim payable', accountType: 'LIABILITY', isPostable: true, isActive: true } as never,
    );
    const doc = await settled();
    const accrual = em.create(JournalEntry, {
      company: em.getReference(Company, companyId), entryDate: '2026-08-02',
      sourceType: 'APPROVAL_ACCRUAL', sourceId: doc, memo: 'claim accrual', createdAt: new Date(),
    } as never);
    await em.flush();
    em.create((await import('./gl.entities')).JournalLine, {
      company: em.getReference(Company, companyId), journalEntry: accrual,
      account: claimPayable, debit: '0', credit: '500.00',
    } as never);
    await em.flush();

    const open = await asCompany(() => journal.openPayables());
    expect(open.items.map((r) => r.documentId)).not.toContain(doc);
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

  /**
   * How late a payable is.
   *
   * Every due date here is built RELATIVE to the company's own day, so the cases mean the same
   * thing whenever they run — an absolute date would drift into another band as the calendar moves.
   */
  describe('ageing', () => {
    /**
     * An open payable whose DUE date is `offset` days from the company's today.
     *
     * The vendor carries real payment terms, so the invoice date and the due date are deliberately
     * NOT the same day: a fixture with zero terms cannot tell ageing-from-due-date apart from
     * ageing-from-invoice-date, and an earlier version of these cases could not.
     */
    const TERM_DAYS = 45;

    async function payableDueIn(offset: number, amount: string): Promise<string> {
      const em = orm.em.fork();
      const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
      const today = localDateIn(new Date(), company.timezone);
      const due = new Date(`${today}T00:00:00Z`);
      due.setUTCDate(due.getUTCDate() + offset);
      // Invoice = due − terms, so the accrual's own date is 45 days earlier than the due date.
      const invoice = new Date(due);
      invoice.setUTCDate(invoice.getUTCDate() - TERM_DAYS);

      const doc = await settled();
      const vendor = em.create(
        (await import('../master-data/master-data.entities')).Vendor,
        { vendorCode: `V-AGE-${++seq}`, name: 'Ageing vendor', paymentTermDays: TERM_DAYS, isActive: true } as never,
      );
      await em.flush();
      const docRow = await em.findOneOrFail(Document, { id: doc }, FILTER_OFF);
      docRow.vendor = em.getReference((await import('../master-data/master-data.entities')).Vendor, vendor.id);

      const apRole = await em.findOneOrFail(
        AccountRole, { company: companyId, role: AccountRoleType.ACCOUNTS_PAYABLE },
        { ...FILTER_OFF, populate: ['account'] },
      );
      const accrual = em.create(JournalEntry, {
        company: em.getReference(Company, companyId), entryDate: invoice.toISOString().slice(0, 10),
        sourceType: 'APPROVAL_ACCRUAL', sourceId: doc, memo: 'ageing fixture', createdAt: new Date(),
      } as never);
      em.create((await import('./gl.entities')).JournalLine, {
        company: em.getReference(Company, companyId), journalEntry: accrual,
        account: apRole.account, debit: '0', credit: amount,
      } as never);
      await em.flush();
      return doc;
    }

    it('ages a payable past its due date into the band its lateness falls in', async () => {
      const doc = await payableDueIn(-40, '500.00');
      const row = (await asCompany(() => journal.openPayables())).items.find((r) => r.documentId === doc);
      expect(row!.daysOverdue).toBe(40);
      expect(row!.bucket).toBe('D31_60');
    });

    it('reports a payable not yet due as not due, with no lateness', async () => {
      // Asserted apart from the case above: a bucket function that always returned a band would
      // pass that one on its own.
      const doc = await payableDueIn(15, '250.00');
      const row = (await asCompany(() => journal.openPayables())).items.find((r) => r.documentId === doc);
      expect(row!.daysOverdue).toBe(0);
      expect(row!.bucket).toBe('NOT_DUE');
    });

    it('puts a payable a day past due in the first band, not the second', async () => {
      const doc = await payableDueIn(-1, '10.00');
      const row = (await asCompany(() => journal.openPayables())).items.find((r) => r.documentId === doc);
      expect(row!.bucket).toBe('D1_30');
    });

    it('reads today from the company timezone, not the server clock', async () => {
      // Guaranteed to discriminate: UTC+14 and UTC-11 are twenty-five hours apart, so their
      // calendar dates ALWAYS differ. A version of this test that merely compared the company day
      // to the UTC day passed whenever the two happened to coincide, which is most of the day.
      const em = orm.em.fork();
      const setZone = async (tz: string) => {
        const c = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
        c.timezone = tz;
        await em.flush();
      };
      const original = (await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF)).timezone;

      await setZone('Pacific/Kiritimati'); // UTC+14
      const east = (await asCompany(() => journal.payablesAgeing())).agedAt;
      await setZone('Pacific/Midway'); // UTC-11
      const west = (await asCompany(() => journal.payablesAgeing())).agedAt;
      await setZone(original);

      expect(east).not.toBe(west);
    });

    it('totals each band to what its rows hold', async () => {
      const summary = await asCompany(() => journal.payablesAgeing());
      const list = await asCompany(() => journal.openPayables());

      for (const band of summary.buckets) {
        const rows = list.items.filter((r) => r.bucket === band.bucket);
        expect(band.count).toBe(rows.length);
        expect(Number(band.total)).toBeCloseTo(rows.reduce((t, r) => t + Number(r.amount), 0), 2);
      }
      // …and the bands together are the whole liability, not a subset of a page.
      expect(Number(summary.total)).toBeCloseTo(
        list.items.reduce((t, r) => t + Number(r.amount), 0), 2,
      );
    });
  });
});
