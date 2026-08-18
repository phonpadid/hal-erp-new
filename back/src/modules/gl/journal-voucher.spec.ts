import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AccountingPeriodStatus, ApproveAction, BudgetTxnType, DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ScopeService } from '../rbac/scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { AccountingPeriod } from '../accounting/period/accounting-period.entities';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { ApprovalDelegation, ApprovalLog, Workflow } from '../approval/approval.entities';
import { ApprovalRoutingService } from '../approval/approval-routing.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { PostActionService } from '../approval/post-action.service';
import { WorkflowStepResolver } from '../approval/workflow-step.resolver';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { BudgetLedgerService } from '../budget/budget-ledger.service';
import { BudgetService } from '../budget/budget.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { DeptDocTypeService } from '../document/dept-doc-type.service';
import { DocumentService } from '../document/document.service';
import { DocumentSubmitService } from '../document/document-submit.service';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { NumberingService } from '../document/numbering.service';
import { ItemService } from '../master-data/item.service';
import { VendorService } from '../master-data/vendor.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { Payment } from '../payment-handoff/payment.entities';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { GlPostingAttempt } from './gl-posting.entities';
import { GlPostingService, SOURCE_MANUAL, SOURCE_REVERSAL } from './gl-posting.service';
import { JournalEntry, JournalLine } from './gl.entities';
import { JournalVoucher } from './journal-voucher.entities';
import { JournalVoucherService } from './journal-voucher.service';
import type { MikroORM } from '@mikro-orm/postgresql';

// Fixtures write budget rows directly; `budget_txn.txn_date` is the day of the event and is
// not nullable, so a fixture must state one just as the ledger service does.
const TODAY = new Date().toISOString().slice(0, 10);

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/** The seeded band: at or above this a voucher needs the second approval as well. */
const SECOND_APPROVAL_FROM = 10_000_000;

/**
 * The entry no event produces, and the route it now travels.
 *
 * A voucher is a document. It is numbered, it rides a workflow whose steps engage by amount, and it
 * is approved through the same engine and the same append-only log as everything else — so a
 * voucher moving 12 million is not checked by the same single person as one moving 5,000.
 *
 * The routing is not started by the submit in these tests: the submit service ANNOUNCES itself with
 * `document.submitted` and the approval listener starts the route, and an EventEmitter is absent
 * from a unit test by design. `raise()` therefore does what the listener does in the app.
 */
describe.skipIf(!hasDb)('journal voucher (DB-backed)', () => {
  let orm: MikroORM;
  let vouchers: JournalVoucherService;
  let routing: ApprovalRoutingService;
  let posting: GlPostingService;
  let companyId = '';
  let departmentId = '';
  let budgetId = '';
  let userId = '';
  let accountantId = '';
  let headId = '';
  let year = 0;
  let expenseCode = '';
  let cashCode = '';
  let seq = 0;

  const as = <T>(uid: string, fn: () => Promise<T>) =>
    RequestContext.run({ userId: uid, companyId, departmentId, grants: [] }, fn);
  const asCompany = <T>(fn: () => Promise<T>) => as(userId, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    const guard = new PeriodGuardService();
    const balance = new BudgetBalanceService(orm.em);
    const budgetLedger = new BudgetLedgerService(orm.em, balance, new BudgetCoverageService(orm.em));
    const items = new ItemService(orm.em, scope, new ScopeService(), accounts);
    const submits = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      new VendorService(orm.em, scope, new ScopeService()),
      items,
      budgetLedger,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    const documents = new DocumentService(
      orm.em,
      scope,
      new DeptDocTypeService(orm.em),
      new NumberingService(orm.em),
      items,
      new BudgetService(orm.em, accounts, balance),
      new FiscalYearService(scope),
    );
    vouchers = new JournalVoucherService(orm.em, scope, accounts, guard, documents, submits);
    routing = new ApprovalRoutingService(
      orm.em,
      new ApproverResolverService(orm.em),
      new PostActionService(budgetLedger, orm.em, undefined, undefined, undefined, guard),
      submits,
      new DocumentRouteService(orm.em, new WorkflowStepResolver(orm.em), new ApproverResolverService(orm.em)),
    );
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em), accounts, guard);

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    // The department the seed maps the JV type to: dept_doc_type is what pins a document's form
    // template and workflow, so a voucher raised anywhere else has no route.
    departmentId = (await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF)).id;
    year = (await em.findOneOrFail(FiscalYear, { company: companyId }, FILTER_OFF)).year;
    budgetId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, FILTER_OFF)).id;
    const user = async (username: string) =>
      (await em.findOneOrFail(AppUser, { username }, FILTER_OFF)).id;
    userId = await user('requester');
    // The two steps of the seeded voucher route, each a distinct person from the author.
    accountantId = await user('accounting');
    headId = await user('accounting_head');
    expenseCode = '5000';
    cashCode = '1000';
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const d = (mm: number, dd: number) => `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  const voucher = (over: Record<string, unknown> = {}) =>
    ({
      entryDate: d(6, 15),
      memo: 'depreciation',
      lines: [
        { accountCode: expenseCode, debit: '5000.00', credit: '0' },
        { accountCode: cashCode, debit: '0', credit: '5000.00' },
      ],
      ...over,
    }) as never;

  /** A voucher for an amount, so a case can choose which side of the band it lands on. */
  const forAmount = (amount: string, over: Record<string, unknown> = {}) =>
    voucher({
      lines: [
        { accountCode: expenseCode, debit: amount, credit: '0' },
        { accountCode: cashCode, debit: '0', credit: amount },
      ],
      ...over,
    });

  /** Raise it and start its route — what the `document.submitted` listener does in the app. */
  const raise = async (over: Record<string, unknown> = {}, by = userId) => {
    const v = await as(by, () => vouchers.submit(voucher(over)));
    await routing.start(v.document.id);
    return v;
  };

  const reverse = async (entryId: string, dto: Record<string, unknown> = {}) => {
    const v = await asCompany(() => vouchers.submitReversal(entryId, dto as never));
    await routing.start(v.document.id);
    return v;
  };

  const approve = (uid: string, documentId: string, action = ApproveAction.APPROVE, remark?: string) =>
    as(uid, () => routing.act(documentId, { action, remark } as never));

  /** Take a small voucher all the way: one approval is its whole route. */
  const postApproved = async (over: Record<string, unknown> = {}) => {
    const v = await raise(over);
    await approve(accountantId, v.document.id);
    const sourceId = v.reversesEntryId ?? v.id;
    const sourceType = v.reversesEntryId ? SOURCE_REVERSAL : SOURCE_MANUAL;
    return orm.em.fork().findOneOrFail(JournalEntry, { sourceType, sourceId }, FILTER_OFF);
  };

  const linesOf = (entryId: string) =>
    orm.em.fork().find(JournalLine, { journalEntry: entryId }, { ...FILTER_OFF, populate: ['account'] });
  const entriesFor = (sourceId: string, sourceType = SOURCE_MANUAL) =>
    orm.em.fork().count(JournalEntry, { sourceType, sourceId }, FILTER_OFF);
  const reload = (documentId: string) =>
    orm.em.fork().findOneOrFail(Document, { id: documentId }, FILTER_OFF);

  // ── The ladder ───────────────────────────────────────────────────────────────────────────────

  it('posts a small voucher after the one approval its route asks for', async () => {
    const entry = await postApproved();

    expect(entry.sourceType).toBe(SOURCE_MANUAL);
    expect(entry.entryDate).toBe(d(6, 15));
    // The ENTRY records the person who PREPARED it, not the one who accepted it. An entry is what
    // its preparer wrote; the approvals are control events about it and live in approval_log.
    expect(entry.createdBy?.id).toBe(userId);
    const lines = await linesOf(entry.id);
    expect(lines.find((l) => l.account.code === expenseCode)?.debit).toBe('5000.00');
    expect(lines.find((l) => l.account.code === cashCode)?.credit).toBe('5000.00');
  });

  it('makes a large voucher wait for the second approver', async () => {
    // The whole point of the change: 12 million and 5,000 no longer take the same route. Asserted
    // together with the small case above — a ladder that never engages would pass one of them alone.
    const v = await asCompany(() => vouchers.submit(forAmount(`${SECOND_APPROVAL_FROM + 2_000_000}.00`)));
    await routing.start(v.document.id);

    await approve(accountantId, v.document.id);
    expect(await entriesFor(v.id)).toBe(0);
    const waiting = await reload(v.document.id);
    expect(waiting.status).toBe(DocStatus.IN_APPROVAL);
    expect(waiting.currentStepNo).toBe(2);

    await approve(headId, v.document.id);
    expect(await entriesFor(v.id)).toBe(1);
    expect((await reload(v.document.id)).status).toBe(DocStatus.COMPLETED);
  });

  it('bands on the sum of the DEBITS, which is neither zero nor double', async () => {
    // The figure the route compares against. Fold a voucher's two sides into one signed amount and
    // it is zero for every voucher that balances — every voucher would take the lowest band. Fold
    // them unsigned and it is double — every voucher would take one band too high.
    const v = await asCompany(() =>
      vouchers.submit(
        voucher({
          lines: [
            { accountCode: expenseCode, debit: '3000.00', credit: '0' },
            { accountCode: expenseCode, debit: '2000.00', credit: '0' },
            { accountCode: cashCode, debit: '0', credit: '4000.00' },
            { accountCode: cashCode, debit: '0', credit: '1000.00' },
          ],
        }),
      ),
    );
    const document = await reload(v.document.id);
    expect(Number(document.totalAmount)).toBe(5000);
    expect(Number(document.budgetBaseTotalAmount)).toBe(5000);
  });

  it('gives the voucher a document number', async () => {
    const v = await raise({ memo: 'numbered' });
    const document = await reload(v.document.id);
    expect(document.docNo).toBeTruthy();
    expect(document.documentType.id).toBeTruthy();
  });

  // ── The control ──────────────────────────────────────────────────────────────────────────────

  it('writes nothing to the ledger on submit', async () => {
    const v = await raise({ memo: 'awaiting' });
    expect(await entriesFor(v.id)).toBe(0);
    expect((await reload(v.document.id)).status).toBe(DocStatus.IN_APPROVAL);
  });

  it('refuses the author approving their own voucher', async () => {
    // Raised by the step-1 approver themselves: eligible for the step, and still refused.
    const v = await raise({ memo: 'self' }, accountantId);
    await expect(approve(accountantId, v.document.id)).rejects.toThrow(/creator/i);
    expect(await entriesFor(v.id)).toBe(0);
  });

  it("refuses the author's delegate too", async () => {
    // The gap the hand-written control had: it compared user ids, so an author who had delegated to
    // a colleague could have that colleague approve their own voucher. Routing compares the
    // DELEGATOR as well, which is why moving onto it made the control stronger rather than equal.
    const em = orm.em.fork();
    const today = new Date().toISOString().slice(0, 10);
    const delegation = em.create(ApprovalDelegation, {
      company: em.getReference(Company, companyId),
      delegator: em.getReference(AppUser, accountantId),
      delegate: em.getReference(AppUser, headId),
      startDate: today,
      endDate: today,
      status: 'ACTIVE',
      createdAt: new Date(),
    } as never);
    await em.flush();

    const v = await raise({ memo: 'via a delegate' }, accountantId);
    await expect(approve(headId, v.document.id)).rejects.toThrow(/creator/i);
    expect(await entriesFor(v.id)).toBe(0);

    await orm.em.fork().nativeDelete(ApprovalDelegation, { id: delegation.id }, FILTER_OFF);
  });

  it('posts once when the same approval is delivered twice', async () => {
    const v = await raise({ memo: 'twice approved' });
    await approve(accountantId, v.document.id);
    // The second finds the document already terminal; the entry stays single either way.
    await approve(accountantId, v.document.id).catch(() => undefined);
    expect(await entriesFor(v.id)).toBe(1);
  });

  it('rejects with a remark and posts nothing', async () => {
    const v = await raise({ memo: 'wrong account' });
    await approve(accountantId, v.document.id, ApproveAction.REJECT, 'wrong expense account');

    expect(await entriesFor(v.id)).toBe(0);
    expect((await reload(v.document.id)).status).toBe(DocStatus.REJECTED);
    const log = await orm.em.fork().findOneOrFail(
      ApprovalLog,
      { document: v.document.id, action: ApproveAction.REJECT },
      FILTER_OFF,
    );
    expect(log.remark).toBe('wrong expense account');
  });

  it('records every step of the route, not only the last decision', async () => {
    const v = await asCompany(() => vouchers.submit(forAmount(`${SECOND_APPROVAL_FROM + 1}.00`)));
    await routing.start(v.document.id);
    await approve(accountantId, v.document.id);
    await approve(headId, v.document.id);

    const logs = await orm.em.fork().find(
      ApprovalLog,
      { document: v.document.id },
      { ...FILTER_OFF, populate: ['approver'], orderBy: { stepNo: 'ASC' } },
    );
    expect(logs.map((l) => l.approver.id)).toEqual([accountantId, headId]);
  });

  it('lets only the author cancel it, and only while it is in approval', async () => {
    const v = await raise({ memo: 'second thoughts' });
    const documentId = v.document.id;
    await expect(as(accountantId, () => vouchers.cancel(documentId))).rejects.toThrow(/creator/i);

    await asCompany(() => vouchers.cancel(documentId));
    expect((await reload(documentId)).status).toBe(DocStatus.CANCELLED);
    expect(await entriesFor(v.id)).toBe(0);
  });

  // ── The period ───────────────────────────────────────────────────────────────────────────────

  it('refuses a voucher raised into a closed period', async () => {
    const closed = await closePeriod('JV-FEB', d(2, 1), d(2, 28));
    await expect(asCompany(() => vouchers.submit(voucher({ entryDate: d(2, 10) }))))
      .rejects.toThrow(/JV-FEB|closed/i);
    // …and an open month is unaffected.
    const ok = await raise({ entryDate: d(3, 10) });
    expect(ok.entryDate).toBe(d(3, 10));
    await dropPeriod(closed);
  });

  it('refuses the approval, without recording it, when the period closed while it waited', async () => {
    // The defect a ladder creates and one checker hides. Every approver but the last has already
    // approved; the last one's action would be rolled back over a period they did not choose and
    // cannot open, leaving the document at a step whose approval can never commit.
    const v = await raise({ entryDate: d(9, 10), memo: 'overtaken by a close' });
    const closed = await closePeriod('JV-SEP', d(9, 1), d(9, 30));

    await expect(approve(accountantId, v.document.id)).rejects.toThrow(/JV-SEP|closed/i);
    expect(await entriesFor(v.id)).toBe(0);
    // No approval happened, so no row claims one did.
    expect(await orm.em.fork().count(ApprovalLog, { document: v.document.id }, FILTER_OFF)).toBe(0);
    // …and the document is still where it was, approvable again once the period reopens.
    expect((await reload(v.document.id)).status).toBe(DocStatus.IN_APPROVAL);

    await dropPeriod(closed);
    await approve(accountantId, v.document.id);
    expect(await entriesFor(v.id)).toBe(1);
  });

  // ── Rules checked at submit ──────────────────────────────────────────────────────────────────

  it('refuses an unbalanced voucher and writes nothing', async () => {
    const before = await orm.em.fork().count(JournalEntry, {}, FILTER_OFF);
    const documents = await orm.em.fork().count(Document, {}, FILTER_OFF);
    await expect(
      asCompany(() => vouchers.submit(voucher({
        lines: [
          { accountCode: expenseCode, debit: '100.00', credit: '0' },
          { accountCode: cashCode, debit: '0', credit: '99.00' },
        ],
      }))),
    ).rejects.toThrow(/does not balance/i);
    expect(await orm.em.fork().count(JournalEntry, {}, FILTER_OFF)).toBe(before);
    // Not even a document: a voucher that could never post must not consume a number or reach a queue.
    expect(await orm.em.fork().count(Document, {}, FILTER_OFF)).toBe(documents);
  });

  it('refuses a line that names an unusable account', async () => {
    // The resolver's rules, not a second copy of them here.
    await expect(
      asCompany(() => vouchers.submit(voucher({
        lines: [
          { accountCode: 'NOPE', debit: '10.00', credit: '0' },
          { accountCode: cashCode, debit: '0', credit: '10.00' },
        ],
      }))),
    ).rejects.toThrow(/NOPE/);

    const em = orm.em.fork();
    const summary = em.create(Account, {
      company: em.getReference(Company, companyId), code: '5999', name: 'Summary node',
      accountType: 'EXPENSE', isPostable: false, isActive: true,
    } as never);
    await em.flush();
    await expect(
      asCompany(() => vouchers.submit(voucher({
        lines: [
          { accountCode: '5999', debit: '10.00', credit: '0' },
          { accountCode: cashCode, debit: '0', credit: '10.00' },
        ],
      }))),
    ).rejects.toThrow(/not postable/);
    expect(summary.id).toBeTruthy();
  });

  it('refuses a line that is two-sided', async () => {
    await expect(
      asCompany(() => vouchers.submit(voucher({
        lines: [
          { accountCode: expenseCode, debit: '10.00', credit: '10.00' },
          { accountCode: cashCode, debit: '0', credit: '10.00' },
        ],
      }))),
    ).rejects.toThrow(/exactly one non-zero side/);
  });

  it('is idempotent with a caller-supplied id, and not without one', async () => {
    const id = randomUUID();
    const first = await raise({ id, memo: 'twice' });
    await approve(accountantId, first.document.id);
    const second = await asCompany(() => vouchers.submit(voucher({ id, memo: 'twice' })));
    expect(second.id).toBe(first.id);
    expect(await entriesFor(id)).toBe(1);
    // And no second document either — a retry that produced one would produce a second route.
    expect(await orm.em.fork().count(JournalVoucher, { id }, FILTER_OFF)).toBe(1);

    // No id supplied = no protection, which is the honest default for a caller who did not ask.
    const a = await asCompany(() => vouchers.submit(voucher({ memo: 'unprotected' })));
    const b = await asCompany(() => vouchers.submit(voucher({ memo: 'unprotected' })));
    expect(b.id).not.toBe(a.id);
  });

  it('touches neither the budget nor the posting queue', async () => {
    // Both absences are decisions, and an absence nobody asserts is one that comes back.
    const budgetBefore = await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF);
    const queueBefore = await orm.em.fork().count(GlPostingAttempt, {}, FILTER_OFF);

    const v = await raise({ memo: 'no side effects' });
    await approve(accountantId, v.document.id);

    expect(await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF)).toBe(budgetBefore);
    expect(await orm.em.fork().count(GlPostingAttempt, {}, FILTER_OFF)).toBe(queueBefore);
  });

  // ── Reversal ─────────────────────────────────────────────────────────────────────────────────

  it('reverses an entry, exchanging the sides and netting to zero', async () => {
    const original = await postApproved({ memo: 'to be reversed' });
    // A reversal takes the SAME route: it is a voucher whose lines were computed for you, and an
    // unreviewed path beside a control is what makes the control decorative.
    const pending = await reverse(original.id);
    expect(await entriesFor(original.id, SOURCE_REVERSAL)).toBe(0);
    await approve(accountantId, pending.document.id);
    const reversal = await orm.em.fork().findOneOrFail(
      JournalEntry, { sourceType: SOURCE_REVERSAL, sourceId: original.id }, FILTER_OFF,
    );

    expect(reversal.createdBy?.id).toBe(userId);
    const both = [...(await linesOf(original.id)), ...(await linesOf(reversal.id))];
    for (const code of [expenseCode, cashCode]) {
      const net = both
        .filter((l) => l.account.code === code)
        .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
      expect(net).toBe(0);
    }
    // The original is untouched — a correction is a new entry, never an edit.
    const still = await orm.em.fork().findOne(JournalEntry, { id: original.id }, FILTER_OFF);
    expect(still?.memo).toBe('to be reversed');
  });

  it('bands a large reversal like any other voucher', async () => {
    // A reversal of a large entry is a large voucher. Computing its lines does not make it smaller,
    // and a route that skipped the band for reversals would be the bypass in a different costume.
    const big = `${SECOND_APPROVAL_FROM + 500}.00`;
    const v = await asCompany(() => vouchers.submit(forAmount(big, { memo: 'large, to reverse' })));
    await routing.start(v.document.id);
    await approve(accountantId, v.document.id);
    await approve(headId, v.document.id);
    const original = await orm.em.fork().findOneOrFail(
      JournalEntry, { sourceType: SOURCE_MANUAL, sourceId: v.id }, FILTER_OFF,
    );

    const rev = await reverse(original.id);
    await approve(accountantId, rev.document.id);
    expect(await entriesFor(original.id, SOURCE_REVERSAL)).toBe(0);
    expect((await reload(rev.document.id)).currentStepNo).toBe(2);

    await approve(headId, rev.document.id);
    expect(await entriesFor(original.id, SOURCE_REVERSAL)).toBe(1);
  });

  it('leaves an engine-posted entry unattributed', async () => {
    // The machine has no author. Naming the approver or the payer would attribute a bookkeeping act
    // to somebody who did not perform one — and it is what makes a MANUAL entry's author mean
    // something when the journal is read.
    const auto = await orm.em.fork().findOne(JournalEntry, { sourceType: 'PAYMENT' }, FILTER_OFF);
    if (auto) expect(auto.createdBy).toBeUndefined();
  });

  it('reverses an AUTOMATIC posting too', async () => {
    // The likelier real case, and the one a careless restriction to manual entries would block.
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { id: departmentId }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const doc = em.create(Document, {
      docNo: `JV-AUTO-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: '700.00', createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL, txnDate: TODAY, amount: '700.00', createdAt: new Date() } as never);
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: '700.00', baseActual: '700.00',
      fxDelta: '0.00', fxKind: 'NONE', whtAmount: '0', paidAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    await posting.postForPayment(doc.id);

    const auto = await orm.em.fork().findOneOrFail(JournalEntry, { sourceType: 'PAYMENT', sourceId: doc.id }, FILTER_OFF);
    const rev = await reverse(auto.id);
    await approve(accountantId, rev.document.id);
    const reversal = await orm.em.fork().findOneOrFail(
      JournalEntry, { sourceType: SOURCE_REVERSAL, sourceId: auto.id }, FILTER_OFF,
    );

    const both = [...(await linesOf(auto.id)), ...(await linesOf(reversal.id))];
    const net = both.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    expect(net).toBe(0);
  });

  it('reverses an entry at most once', async () => {
    const original = await postApproved({ memo: 'once only' });
    const first = await reverse(original.id);
    // A second is refused while the first is merely IN APPROVAL — two in-flight reversals would both
    // be approvable and the loser would fail at the unique index with nobody having been told.
    await expect(asCompany(() => vouchers.submitReversal(original.id, {}))).rejects.toThrow(/awaiting approval/);
    await approve(accountantId, first.document.id);
    await expect(asCompany(() => vouchers.submitReversal(original.id, {}))).rejects.toThrow(/already been reversed/);

    expect(await entriesFor(original.id, SOURCE_REVERSAL)).toBe(1);
  });

  it('lets a cancelled reversal be raised again', async () => {
    // "At most once" counts what is posted and what is in flight — not what somebody thought better
    // of. A cancelled reversal that blocked the entry from ever being corrected would be worse than
    // the duplicate it was preventing.
    const original = await postApproved({ memo: 'reversal withdrawn' });
    const first = await reverse(original.id);
    await asCompany(() => vouchers.cancel(first.document.id));

    const second = await reverse(original.id);
    expect(second.id).not.toBe(first.id);
  });

  it('dates a reversal when it was decided, not when the original was', async () => {
    const original = await postApproved({ entryDate: d(4, 10), memo: 'in a month to close' });
    const closed = await closePeriod('JV-APR', d(4, 1), d(4, 30));

    // No date given: today, which is outside the closed month, so it is accepted rather than
    // refused for being dated into a period somebody has already reported.
    const pending = await reverse(original.id);
    await approve(accountantId, pending.document.id);
    const reversal = await orm.em.fork().findOneOrFail(
      JournalEntry, { sourceType: SOURCE_REVERSAL, sourceId: original.id }, FILTER_OFF,
    );
    expect(reversal.entryDate).not.toBe(d(4, 10));

    await dropPeriod(closed);
  });

  it("refuses to reverse another company's entry", async () => {
    const em = orm.em.fork();
    const other = em.create(Company, {
      code: `JV-B-${++seq}`, nameTh: 'B', nameEn: 'B', taxId: `9${seq}`, branchCode: '00000',
      isActive: true, createdAt: new Date(),
    } as never);
    await em.flush();
    const foreign = em.create(JournalEntry, {
      company: other, entryDate: d(5, 1), sourceType: SOURCE_MANUAL,
      sourceId: randomUUID(), memo: 'theirs', createdAt: new Date(),
    } as never);
    await em.flush();

    await expect(asCompany(() => vouchers.submitReversal(foreign.id, {}))).rejects.toThrow(/not found/i);
  });

  // ── The queue ────────────────────────────────────────────────────────────────────────────────

  it('lists what is waiting with the step it waits at, and drops it once decided', async () => {
    const v = await asCompany(() => vouchers.submit(forAmount(`${SECOND_APPROVAL_FROM + 7}.00`, { memo: 'in the queue' })));
    await routing.start(v.document.id);

    const waiting = (await asCompany(() => vouchers.pending())).find((x) => x.voucher.id === v.id);
    expect(waiting?.currentStepNo).toBe(1);
    expect(Number(waiting?.total)).toBe(SECOND_APPROVAL_FROM + 7);

    // The step is part of the answer: after the first approval it is a DIFFERENT person being
    // waited for, and a queue that only says "pending" cannot tell them apart.
    await approve(accountantId, v.document.id);
    expect((await asCompany(() => vouchers.pending())).find((x) => x.voucher.id === v.id)?.currentStepNo).toBe(2);

    await approve(headId, v.document.id);
    expect((await asCompany(() => vouchers.pending())).map((x) => x.voucher.id)).not.toContain(v.id);
  });

  it('keeps another company vouchers out of the queue', async () => {
    const em = orm.em.fork();
    const base = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    const other = em.create(Company, {
      code: `JVO-${++seq}`, nameTh: 'Other', taxId: `${seq}9`, branchCode: '00000',
      baseCurrency: base.baseCurrency, isActive: true, createdAt: new Date(),
    } as never);
    await em.flush();

    // Their document is IN_APPROVAL, so this row would be returned by the read if the company
    // filter were the thing that was missing. It borrows the seeded type, template and workflow —
    // the read joins the document only for its status, and configuring a second company end to end
    // would be a fixture about configuration rather than about isolation.
    const dept = await em.findOneOrFail(Department, { id: departmentId }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(
      DeptDocType,
      { department: dept.id, documentType: prType.id },
      { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] },
    );
    const theirDoc = em.create(Document, {
      docNo: `JV-OTHER-${seq}`, company: other, department: dept, documentType: prType,
      formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.IN_APPROVAL, currentStepNo: 1, createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(JournalVoucher, {
      company: other, document: theirDoc, entryDate: d(6, 1), memo: 'theirs', createdAt: new Date(),
    } as never);
    await em.flush();

    expect((await asCompany(() => vouchers.pending())).every((x) => x.voucher.memo !== 'theirs')).toBe(true);
  });

  // ── fixtures ─────────────────────────────────────────────────────────────────────────────────

  async function closePeriod(code: string, start: string, end: string): Promise<string> {
    const em = orm.em.fork();
    const fy = await em.findOneOrFail(FiscalYear, { company: companyId }, FILTER_OFF);
    const period = em.create(AccountingPeriod, {
      company: em.getReference(Company, companyId), fiscalYear: fy, code,
      periodStart: start, periodEnd: end, status: AccountingPeriodStatus.CLOSED,
      createdAt: new Date(),
    } as never);
    await em.flush();
    return period.id;
  }

  const dropPeriod = (id: string) =>
    orm.em.fork().nativeDelete(AccountingPeriod, { id }, FILTER_OFF);
});
