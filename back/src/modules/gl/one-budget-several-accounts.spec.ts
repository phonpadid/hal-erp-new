import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, DocStatus, GlPostingStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Money } from '../../common/money/money';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { AccountService } from '../accounting/account.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Workflow } from '../approval/approval.entities';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { DeptDocType, Document, DocumentLine, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { GlPostingAttempt } from './gl-posting.entities';
import { GlPostingService, SOURCE_PAYMENT } from './gl-posting.service';
import { JournalEntry, JournalLine } from './gl.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const TODAY = new Date().toISOString().slice(0, 10);
const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * One budget, several accounts.
 *
 * The expense side used to be keyed by `budget.account_id`, so a budget could debit exactly one
 * account and an account configured on the item or the document type never reached an entry. It is
 * keyed by the line's stamped account now, with each ACTUAL apportioned across the lines that
 * charged that budget.
 */
describe.skipIf(!hasDb)('the expense side follows the line, not the budget (DB-backed)', () => {
  let orm: MikroORM;
  let posting: GlPostingService;
  let companyId = '';
  let budgetId = '';
  let seq = 0;
  const account: Record<string, Account> = {};

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em), new AccountService(orm.em, scope), new PeriodGuardService());

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    budgetId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, FILTER_OFF)).id;
    for (const code of ['5000', '5900']) {
      account[code] = await em.findOneOrFail(Account, { company: companyId, code }, FILTER_OFF);
    }
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  /**
   * A settled document whose lines carry a basis and, optionally, a stamped account each.
   * `actual` defaults to the sum of the bases — pass less to model a partial settlement.
   */
  async function settled(
    lines: Array<{ basis: string; accountCode?: string }>,
    actual?: string,
  ): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const requester = await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF);
    const total = lines.reduce((s, l) => Money.add(s, l.basis), '0');

    const doc = em.create(Document, {
      docNo: `SPLIT-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id), createdBy: requester,
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: total, createdAt: new Date(),
    } as never);
    await em.flush();

    lines.forEach((l, i) => {
      em.create(DocumentLine, {
        document: doc, lineNo: i + 1, description: `line ${i + 1}`,
        qty: '1', unitPrice: l.basis, lineAmount: l.basis,
        budgetBaseLineAmount: l.basis, baseLineAmount: l.basis,
        budget: em.getReference(Budget, budgetId),
        account: l.accountCode ? em.getReference(Account, account[l.accountCode].id) : undefined,
      } as never);
    });
    em.create(BudgetTxn, {
      budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL,
      txnDate: TODAY, amount: actual ?? total, createdAt: new Date(),
    } as never);
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: actual ?? total, baseActual: actual ?? total,
      fxDelta: '0.00', fxKind: 'NONE', whtAmount: '0', paidAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  /**
   * A settlement document at the tail of a chain: references `chargedId` (which holds the ACTUAL
   * rows and the charged lines), carries its own lines by the same `line_no` — each with its own
   * stamp, or none — and the payment. What `create-from` builds for a PR → DISB pair, minus the
   * PO in the middle, which the walk does not care about.
   */
  async function settledVia(
    chargedId: string,
    ownLines: Array<{ basis: string; accountCode?: string }>,
  ): Promise<string> {
    const em = orm.em.fork();
    const charged = await em.findOneOrFail(Document, { id: chargedId }, { ...FILTER_OFF, populate: ['department', 'documentType', 'formTemplate', 'workflow', 'createdBy'] });
    const total = ownLines.reduce((s, l) => Money.add(s, l.basis), '0');
    const doc = em.create(Document, {
      docNo: `SPLIT-DISB-${++seq}`, company: em.getReference(Company, companyId), department: charged.department,
      documentType: charged.documentType, formTemplate: charged.formTemplate, workflow: charged.workflow,
      createdBy: charged.createdBy, refDocument: charged,
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: total, createdAt: new Date(),
    } as never);
    await em.flush();
    ownLines.forEach((l, i) => {
      em.create(DocumentLine, {
        document: doc, lineNo: i + 1, description: `line ${i + 1}`,
        qty: '1', unitPrice: l.basis, lineAmount: l.basis,
        budgetBaseLineAmount: l.basis, baseLineAmount: l.basis,
        // A settlement type is not budget-controlled: no budget on its lines, only a stamp.
        account: l.accountCode ? em.getReference(Account, account[l.accountCode].id) : undefined,
      } as never);
    });
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: total, baseActual: total,
      fxDelta: '0.00', fxKind: 'NONE', whtAmount: '0', paidAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  /** A charged document with lines and ACTUAL rows but no payment of its own — the head of a chain. */
  async function chargedOnly(lines: Array<{ basis: string; accountCode?: string }>): Promise<string> {
    const id = await settled(lines);
    const em = orm.em.fork();
    await em.nativeDelete(Payment, { document: id }, FILTER_OFF);
    return id;
  }

  /** Debits of the posted entry, by account code. */
  async function debits(documentId: string): Promise<Map<string, string>> {
    const em = orm.em.fork();
    const entry = await em.findOneOrFail(
      JournalEntry, { sourceType: SOURCE_PAYMENT, sourceId: documentId }, FILTER_OFF,
    );
    const lines = await em.find(JournalLine, { journalEntry: entry.id }, { ...FILTER_OFF, populate: ['account'] });
    const out = new Map<string, string>();
    for (const l of lines) {
      if (Money.compare(l.debit, '0') <= 0) continue;
      out.set(l.account.code, Money.add(out.get(l.account.code) ?? '0', l.debit));
    }
    return out;
  }

  it('debits two accounts for one budget when its lines name two', async () => {
    const doc = await settled([
      { basis: '600.00', accountCode: '5000' },
      { basis: '400.00', accountCode: '5900' },
    ]);
    await posting.postForPayment(doc);

    const d = await debits(doc);
    expect(Money.compare(d.get('5000')!, '600')).toBe(0);
    expect(Money.compare(d.get('5900')!, '400')).toBe(0);
  });

  it('sums lines that name the same account into one debit', async () => {
    const doc = await settled([
      { basis: '300.00', accountCode: '5000' },
      { basis: '700.00', accountCode: '5000' },
    ]);
    await posting.postForPayment(doc);

    const d = await debits(doc);
    expect(Money.compare(d.get('5000')!, '1000')).toBe(0);
    expect(d.has('5900')).toBe(false);
  });

  it('apportions a partial settlement pro rata across the accounts', async () => {
    // Reserved 1000 over 600/400, settled 500 and released the rest.
    const doc = await settled([
      { basis: '600.00', accountCode: '5000' },
      { basis: '400.00', accountCode: '5900' },
    ], '500.00');
    await posting.postForPayment(doc);

    const d = await debits(doc);
    expect(Money.compare(d.get('5000')!, '300')).toBe(0);
    expect(Money.compare(d.get('5900')!, '200')).toBe(0);
  });

  it("posts an unstamped line to its budget's account, as it always did", async () => {
    const doc = await settled([{ basis: '1000.00' }]);
    await posting.postForPayment(doc);

    // The budget's own account is 5000 — the fallback, and the behaviour every document submitted
    // before the stamp keeps for the rest of its life.
    const d = await debits(doc);
    expect(Money.compare(d.get('5000')!, '1000')).toBe(0);
  });

  it('mixes a stamped and an unstamped line on one document', async () => {
    const doc = await settled([
      { basis: '400.00', accountCode: '5900' },
      { basis: '600.00' },
    ]);
    await posting.postForPayment(doc);

    const d = await debits(doc);
    expect(Money.compare(d.get('5900')!, '400')).toBe(0);
    expect(Money.compare(d.get('5000')!, '600')).toBe(0);
  });

  // ---- which document's line: the posted one first, the charged ancestor second ----------------
  //
  // On a chain the ACTUAL rows live on the reserving ancestor, and so did the only lines this read
  // looked at — so an account moved on the settlement document by its accounting step
  // (`recode-line-account-at-step`) posted nowhere. The posted document's own stamp now outranks the
  // ancestor's, by line_no; a line with no stamp of its own still falls back to the ancestor's.

  it("posts a chained settlement on the settling document's re-coded line, not the ancestor's", async () => {
    const pr = await chargedOnly([{ basis: '1000.00', accountCode: '5000' }]);
    // The DISB copied the PR's line and its accounting step moved it to 5900.
    const disb = await settledVia(pr, [{ basis: '1000.00', accountCode: '5900' }]);
    await posting.postForPayment(disb);

    const d = await debits(disb);
    expect(Money.compare(d.get('5900')!, '1000')).toBe(0);
    expect(d.has('5000')).toBe(false);
  });

  it("lets a chained document's own differing stamp outrank the ancestor's even with no re-code", async () => {
    // Stated as a decision, not a surprise: both are "the stamp that document's approvers saw";
    // the settlement's is the later one and the one accounting signed.
    const pr = await chargedOnly([
      { basis: '600.00', accountCode: '5000' },
      { basis: '400.00', accountCode: '5000' },
    ]);
    const disb = await settledVia(pr, [
      { basis: '600.00', accountCode: '5900' },
      { basis: '400.00', accountCode: '5000' },
    ]);
    await posting.postForPayment(disb);

    const d = await debits(disb);
    expect(Money.compare(d.get('5900')!, '600')).toBe(0);
    expect(Money.compare(d.get('5000')!, '400')).toBe(0);
  });

  it("falls back to the ancestor's stamp where the settling document's line has none", async () => {
    const pr = await chargedOnly([{ basis: '1000.00', accountCode: '5900' }]);
    const disb = await settledVia(pr, [{ basis: '1000.00' }]);
    await posting.postForPayment(disb);

    const d = await debits(disb);
    expect(Money.compare(d.get('5900')!, '1000')).toBe(0);
  });

  it('posts a non-chained document exactly as before when one of its lines was re-coded', async () => {
    // A recode on a document that holds its own ACTUAL rows is just a different stamp on its own
    // line: the "own" read and the "charged" read are the same line.
    const doc = await settled([
      { basis: '600.00', accountCode: '5900' }, // re-coded from 5000 mid-route
      { basis: '400.00', accountCode: '5000' },
    ]);
    await posting.postForPayment(doc);

    const d = await debits(doc);
    expect(Money.compare(d.get('5900')!, '600')).toBe(0);
    expect(Money.compare(d.get('5000')!, '400')).toBe(0);
    const total = [...d.values()].reduce((a, b) => Money.add(a, b), '0');
    expect(Money.compare(total, '1000')).toBe(0);
  });

  it('keeps the expense side equal to what the budget was cut by', async () => {
    // The property the entry's balance rests on, asserted end to end rather than only on the
    // apportionment function: three uneven lines whose shares cannot divide exactly.
    const doc = await settled([
      { basis: '333.33', accountCode: '5000' },
      { basis: '333.33', accountCode: '5900' },
      { basis: '333.34', accountCode: '5000' },
    ], '1000.00');
    await posting.postForPayment(doc);

    const d = await debits(doc);
    const total = [...d.values()].reduce((a, b) => Money.add(a, b), '0');
    expect(Money.compare(total, '1000')).toBe(0);
    const row = await orm.em.fork().findOne(GlPostingAttempt, { sourceType: SOURCE_PAYMENT, sourceId: doc }, FILTER_OFF);
    expect(row?.status).toBe(GlPostingStatus.POSTED);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[one-budget-several-accounts] no database reachable — skipping');
}
