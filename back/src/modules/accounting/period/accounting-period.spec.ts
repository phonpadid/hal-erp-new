import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestContext } from '../../../common/context/request-context';
import {
  AccountingPeriodStatus, BudgetTxnType, DocStatus, GlPostingStatus, PeriodAction,
} from '../../../common/enums';
import { CompanyScopeService } from '../../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../../test/test-orm';
import { AccountService } from '../account.service';
import { Workflow } from '../../approval/approval.entities';
import { Budget, BudgetTxn } from '../../budget/budget.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../../document/document.entities';
import { Company, Department, FiscalYear } from '../../multi-company/multi-company.entities';
import { Payment } from '../../payment-handoff/payment.entities';
import { AppUser } from '../../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../../seed/seed-data';
import { AccountRoleService } from '../../gl/account-role.service';
import { ExchangeRateService } from '../../currency/exchange-rate.service';
import { FxRevaluationService } from '../../gl/fx-revaluation.service';
import { ReceivedNotInvoicedService } from '../../gl/received-not-invoiced.service';
import { YearCloseService } from '../../gl/year-close.service';
import { GlPostingService } from '../../gl/gl-posting.service';
import { AccountRole, JournalEntry } from '../../gl/gl.entities';
import { JournalService } from '../../gl/journal.service';
import { GlPostingAttempt } from '../../gl/gl-posting.entities';
import { AccountingPeriod, AccountingPeriodLog } from './accounting-period.entities';
import { AccountingPeriodService } from './accounting-period.service';
import { PeriodGuardService } from './period-guard.service';
import type { MikroORM } from '@mikro-orm/postgresql';

// Fixtures write budget rows directly; `budget_txn.txn_date` is the day of the event and is
// not nullable, so a fixture must state one just as the ledger service does.
const TODAY = new Date().toISOString().slice(0, 10);

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * A month the books can be closed on.
 *
 * The close is not a flag: postings run after their business transaction commits, so at the moment
 * of a close there may be work already committed whose entry is not yet written. Refusing those
 * afterwards would lose them. So a close first establishes that the period is drained.
 */
describe.skipIf(!hasDb)('accounting period (DB-backed)', () => {
  let orm: MikroORM;
  let periods: AccountingPeriodService;
  let posting: GlPostingService;
  let journal: JournalService;
  let companyId = '';
  let fiscalYearId = '';
  let budgetId = '';
  let userId = '';
  let year = 0;
  let seq = 0;

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId, departmentId: 'd', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    journal = new JournalService(scope);
    periods = new AccountingPeriodService(
      scope,
      journal,
      new ReceivedNotInvoicedService(orm.em),
      new FxRevaluationService(orm.em, new ExchangeRateService(orm.em)),
      new AccountRoleService(orm.em),
      new PeriodGuardService(),
      new YearCloseService(new AccountRoleService(orm.em), new PeriodGuardService()),
    );
    posting = new GlPostingService(
      orm.em,
      new AccountRoleService(orm.em),
      new AccountService(orm.em, scope),
      new PeriodGuardService(),
    );

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    const fy = await em.findOneOrFail(FiscalYear, { company: companyId }, FILTER_OFF);
    fiscalYearId = fy.id;
    year = fy.year;
    budgetId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, FILTER_OFF)).id;
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const m = (mm: number, dd: number) => `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  const declare = (code: string, start: string, end: string) =>
    asCompany(() => periods.declare({ fiscalYearId, code, periodStart: start, periodEnd: end }));

  /** A settled document whose payment posts on `paidAt`. */
  async function settled(paidAt: Date): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const doc = em.create(Document, {
      docNo: `PER-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: '1000.00', createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL, txnDate: TODAY, amount: '1000.00', createdAt: new Date() } as never);
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: '1000.00', baseActual: '1000.00',
      fxDelta: '0.00', fxKind: 'NONE', whtAmount: '0', paidAt, createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  const entryFor = (documentId: string) =>
    orm.em.fork().findOne(JournalEntry, { sourceType: 'PAYMENT', sourceId: documentId }, FILTER_OFF);

  /**
   * Reset the period state AND the posting queue between cases.
   *
   * The queue matters because the readiness check asks the whole company, not a date range: a
   * failed posting left behind by an earlier case would block every close after it — which is the
   * production behaviour, and exactly why each case here starts from a drained queue.
   */
  const wipePeriods = async () => {
    const em = orm.em.fork();
    await em.nativeDelete(AccountingPeriodLog, {});
    await em.nativeDelete(AccountingPeriod, { company: companyId }, FILTER_OFF);
    await em.nativeDelete(GlPostingAttempt, { company: companyId }, FILTER_OFF);
    // Closing the final period now closes the year on BOTH sides, so a reset that only removed the
    // periods would leave the next case starting from a closed year and closed budgets.
    await em.nativeUpdate(FiscalYear, { id: fiscalYearId }, { status: 'OPEN' }, FILTER_OFF);
    await em.nativeUpdate(Budget, { fiscalYear: fiscalYearId, status: 'CLOSED' }, { status: 'ACTIVE' }, FILTER_OFF);
    await em.nativeDelete(BudgetTxn, { budget: budgetId }, FILTER_OFF);
  };

  // ── The rule that makes this shippable ────────────────────────────────────────────────────────

  it('a company that declared no period posts exactly as before', async () => {
    // The first assertion to hold and the last one to ever break: every existing fixture in this
    // codebase has no periods, and all of them must be untouched.
    await wipePeriods();
    const doc = await settled(new Date(`${year}-05-15T04:00:00Z`));
    await posting.postForPayment(doc);
    expect(await entryFor(doc)).not.toBeNull();
  });

  // ── Declaring ────────────────────────────────────────────────────────────────────────────────

  it('declares a calendar month and a book month that is not one', async () => {
    await wipePeriods();
    const cal = await declare('P-01', m(1, 1), m(1, 31));
    expect(cal.status).toBe(AccountingPeriodStatus.OPEN);
    // Taken exactly as given — a company whose books run the 26th to the 25th has to say so.
    const book = await declare('P-26', m(2, 26), m(3, 25));
    expect(book.periodStart).toBe(m(2, 26));
    expect(book.periodEnd).toBe(m(3, 25));
  });

  it('rejects an overlap, a reversed range, and a range outside its fiscal year', async () => {
    await wipePeriods();
    await declare('P-A', m(4, 1), m(4, 30));

    await expect(declare('P-CLASH', m(4, 20), m(5, 20))).rejects.toThrow(/overlaps/);
    await expect(declare('P-REV', m(6, 30), m(6, 1))).rejects.toThrow(/precedes/);
    await expect(declare('P-OUT', `${year + 1}-01-01`, `${year + 1}-01-31`)).rejects.toThrow(/outside fiscal year/);
  });

  it('allows a gap between periods', async () => {
    await wipePeriods();
    await declare('P-JUN', m(6, 1), m(6, 30));
    await declare('P-AUG', m(8, 1), m(8, 31));
    // July is simply not a period: nothing to close, and every July date stays writable.
    const all = await asCompany(() => periods.list());
    expect(all.map((p) => p.code)).toEqual(['P-JUN', 'P-AUG']);
  });

  // ── The guard ────────────────────────────────────────────────────────────────────────────────

  it('refuses an entry dated in a closed period, and posts one in an open or undeclared day', async () => {
    await wipePeriods();
    const jul = await declare('G-JUL', m(7, 1), m(7, 31));
    await declare('G-AUG', m(8, 1), m(8, 31));
    await asCompany(() => periods.close(jul.id));

    const inClosed = await settled(new Date(`${year}-07-15T04:00:00Z`));
    await expect(posting.postForPayment(inClosed)).rejects.toThrow(/G-JUL/);
    expect(await entryFor(inClosed)).toBeNull();

    const inOpen = await settled(new Date(`${year}-08-15T04:00:00Z`));
    await posting.postForPayment(inOpen);
    expect(await entryFor(inOpen)).not.toBeNull();

    // September was never declared, so nothing covers it.
    const undeclared = await settled(new Date(`${year}-09-15T04:00:00Z`));
    await posting.postForPayment(undeclared);
    expect(await entryFor(undeclared)).not.toBeNull();
  });

  it('records a refused posting as undelivered, and posts it after a reopen with its original date', async () => {
    await wipePeriods();
    const oct = await declare('R-OCT', m(10, 1), m(10, 31));
    await asCompany(() => periods.close(oct.id));

    const doc = await settled(new Date(`${year}-10-10T04:00:00Z`));
    await expect(posting.postForPayment(doc)).rejects.toThrow(/R-OCT/);

    // Visible, not lost — the machinery from see-what-the-journal-failed-to-post, unchanged.
    const owed = await asCompany(() => journal.undelivered({ limit: 100 }));
    const row = owed.items.find((r) => r.sourceId === doc);
    expect(row?.status).toBe(GlPostingStatus.FAILED);
    expect(row?.lastError).toMatch(/R-OCT/);

    await asCompany(() => periods.reopen(oct.id, 'a late invoice arrived'));
    await posting.postForPayment(doc);
    const entry = await entryFor(doc);
    // Its ORIGINAL date: a refused posting is not redirected into a later open month.
    expect(entry?.entryDate).toBe(m(10, 10));
  });

  // ── Closing ──────────────────────────────────────────────────────────────────────────────────

  it('refuses to close while a posting is still owed, and closes once it is delivered', async () => {
    await wipePeriods();
    const nov = await declare('C-NOV', m(11, 1), m(11, 30));

    // A posting that failed for its own reasons, dated inside the period.
    const em = orm.em.fork();
    await em.nativeDelete(AccountRole, { company: companyId, role: 'CASH_CLEARING' }, FILTER_OFF);
    const doc = await settled(new Date(`${year}-11-10T04:00:00Z`));
    await expect(posting.postForPayment(doc)).rejects.toThrow(/CASH_CLEARING/);

    try {
      await expect(asCompany(() => periods.close(nov.id))).rejects.toThrow(/still owes/);
    } finally {
      // Restored whatever the assertion did: leaving the role unmapped would fail every case after
      // this one for a reason that has nothing to do with periods.
      const restore = orm.em.fork();
      if (!(await restore.findOne(AccountRole, { company: companyId, role: 'CASH_CLEARING' }, FILTER_OFF))) {
        const acct = await restore.findOneOrFail(
          (await import('../accounting.entities')).Account,
          { company: companyId, code: '1000' },
          FILTER_OFF,
        );
        restore.create(AccountRole, { company: restore.getReference(Company, companyId), role: 'CASH_CLEARING', account: acct } as never);
        await restore.flush();
      }
    }

    // Deliver it, and the same close succeeds.
    await posting.postForPayment(doc);

    const closed = await asCompany(() => periods.close(nov.id));
    expect(closed.status).toBe(AccountingPeriodStatus.CLOSED);
  });

  it('a skipped posting does not block the close', async () => {
    // Without this, every document that legitimately posts nothing would make its month
    // permanently unclosable.
    await wipePeriods();
    const dec = await declare('S-DEC', m(12, 1), m(12, 31));

    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const doc = em.create(Document, {
      docNo: `PER-SKIP-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: '500.00', createdAt: new Date(),
    } as never);
    await em.flush();
    // A payment with NO ACTUAL rows: nothing to post, recorded SKIPPED terminally.
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: '500.00', baseActual: '500.00',
      fxDelta: '0.00', fxKind: 'NONE', whtAmount: '0',
      paidAt: new Date(`${year}-12-10T04:00:00Z`), createdAt: new Date(),
    } as never);
    await em.flush();
    await posting.postForPayment(doc);

    const closed = await asCompany(() => periods.close(dec.id));
    expect(closed.status).toBe(AccountingPeriodStatus.CLOSED);
  });

  // ---- Closing the year closes its budgets ---------------------------------
  //
  // The ledger used to declare a year finished while its appropriations stayed spendable. Nothing
  // in the budget module knew `fiscal_year.status` existed.

  /** A document still holding a reservation against `budgetId`, in a non-terminal state. */
  async function holdingDoc(status: DocStatus = DocStatus.IN_APPROVAL): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const doc = em.create(Document, {
      docNo: `HOLD-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId),
      status, currentStepNo: 1, baseTotalAmount: '700.00', createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(BudgetTxn, {
      budget: em.getReference(Budget, budgetId), document: doc,
      txnType: BudgetTxnType.RESERVE, txnDate: TODAY, amount: '700.00', createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  const budgetStatus = async () =>
    (await orm.em.fork().findOneOrFail(Budget, { id: budgetId }, FILTER_OFF)).status;

  const yearStatus = async () =>
    (await orm.em.fork().findOneOrFail(FiscalYear, { id: fiscalYearId }, FILTER_OFF)).status;

  it('refuses to close the year while a document still holds its budget, naming it', async () => {
    await wipePeriods();
    const dec = await declare('BY-DEC', m(12, 1), m(12, 31));
    const docId = await holdingDoc();

    await expect(asCompany(() => periods.close(dec.id))).rejects.toThrow(/holding its budget/i);
    // Nothing was done: the period is still open and the year is untouched.
    expect((await orm.em.fork().findOneOrFail(AccountingPeriod, { id: dec.id }, FILTER_OFF)).status)
      .toBe(AccountingPeriodStatus.OPEN);
    expect(await yearStatus()).toBe('OPEN');
    void docId;
  });

  it('closes once the holding document releases, and closes the year budgets with it', async () => {
    await wipePeriods();
    const dec = await declare('BY-DEC2', m(12, 1), m(12, 31));
    const docId = await holdingDoc();

    // Cancelling releases the hold — the remedy the refusal asks for.
    const em = orm.em.fork();
    const doc = await em.findOneOrFail(Document, { id: docId }, FILTER_OFF);
    doc.status = DocStatus.CANCELLED;
    em.create(BudgetTxn, {
      budget: em.getReference(Budget, budgetId), document: doc,
      txnType: BudgetTxnType.RELEASE, txnDate: TODAY, amount: '700.00', createdAt: new Date(),
    } as never);
    await em.flush();

    const before = await orm.em.fork().findOneOrFail(Budget, { id: budgetId }, FILTER_OFF);
    await asCompany(() => periods.close(dec.id));

    expect(await yearStatus()).toBe('CLOSED');
    expect(await budgetStatus()).toBe('CLOSED');
    // The appropriation stands as a record: nothing about the figure moved.
    const after = await orm.em.fork().findOneOrFail(Budget, { id: budgetId }, FILTER_OFF);
    expect(after.amountTotal).toBe(before.amountTotal);
  });

  it('does not ask about reservations when the period is not the year last', async () => {
    await wipePeriods();
    const jul = await declare('BY-JUL', m(7, 1), m(7, 31));
    await holdingDoc();
    await asCompany(() => periods.close(jul.id));
    expect(await budgetStatus()).toBe('ACTIVE');
  });

  it('reopening the final period reopens the year and its budgets', async () => {
    await wipePeriods();
    const dec = await declare('BY-DEC3', m(12, 1), m(12, 31));
    await asCompany(() => periods.close(dec.id));
    expect(await budgetStatus()).toBe('CLOSED');

    await asCompany(() => periods.reopen(dec.id, 'the audit found a correction'));
    expect(await yearStatus()).toBe('OPEN');
    expect(await budgetStatus()).toBe('ACTIVE');
  });

  it('refuses to close out of order and to reopen under a closed later period', async () => {
    await wipePeriods();
    const jul = await declare('O-JUL', m(7, 1), m(7, 31));
    const aug = await declare('O-AUG', m(8, 1), m(8, 31));

    await expect(asCompany(() => periods.close(aug.id))).rejects.toThrow(/still open/);

    await asCompany(() => periods.close(jul.id));
    await asCompany(() => periods.close(aug.id));
    // August's comparatives already depend on July being final.
    await expect(asCompany(() => periods.reopen(jul.id, 'nope'))).rejects.toThrow(/reopen the later period first/);
  });

  it('refuses to close a period twice', async () => {
    await wipePeriods();
    const p = await declare('T-JAN', m(1, 1), m(1, 31));
    await asCompany(() => periods.close(p.id));
    await expect(asCompany(() => periods.close(p.id))).rejects.toThrow(BadRequestException);
  });

  // ── Reopening ────────────────────────────────────────────────────────────────────────────────

  it('reopens with a reason and logs both actions, append-only', async () => {
    await wipePeriods();
    const p = await declare('L-MAR', m(3, 1), m(3, 31));
    await asCompany(() => periods.close(p.id));
    await expect(asCompany(() => periods.reopen(p.id, '   '))).rejects.toThrow(/requires a reason/);
    await asCompany(() => periods.reopen(p.id, 'auditor found a misposting'));

    const log = await orm.em.fork().find(AccountingPeriodLog, { period: p.id }, { ...FILTER_OFF, orderBy: { actedAt: 'ASC' } });
    // DECLARE leads: the act that created the period is recorded too, and it happened first.
    expect(log.map((l) => l.action)).toEqual([
      PeriodAction.DECLARE, PeriodAction.CLOSE, PeriodAction.REOPEN,
    ]);
    expect(log[2].reason).toBe('auditor found a misposting');

    // The history cannot be edited — a history that can be answers nothing.
    const em = orm.em.fork();
    const row = await em.findOneOrFail(AccountingPeriodLog, { id: log[1].id }, FILTER_OFF);
    row.reason = 'rewritten';
    await expect(em.flush()).rejects.toThrow();
  });

  // ── Isolation ────────────────────────────────────────────────────────────────────────────────

  it('another company\'s closed period neither lists nor blocks', async () => {
    await wipePeriods();
    const em = orm.em.fork();
    const other = em.create(Company, {
      code: 'PER-B', nameTh: 'B', nameEn: 'B', taxId: '88', branchCode: '00000', isActive: true, createdAt: new Date(),
    } as never);
    const otherFy = em.create(FiscalYear, {
      company: other, year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: 'OPEN',
    } as never);
    await em.flush();
    em.create(AccountingPeriod, {
      company: other, fiscalYear: otherFy, code: 'B-APR',
      periodStart: m(4, 1), periodEnd: m(4, 30), status: AccountingPeriodStatus.CLOSED, createdAt: new Date(),
    } as never);
    await em.flush();

    const mine = await asCompany(() => periods.list());
    expect(mine.map((p) => p.code)).not.toContain('B-APR');

    // …and it does not close this company's April.
    const doc = await settled(new Date(`${year}-04-15T04:00:00Z`));
    await posting.postForPayment(doc);
    expect(await entryFor(doc)).not.toBeNull();
  });
  /**
   * The two reads the period screen needed and did not have.
   *
   * Both existed as data long before they existed as endpoints: fiscal years were listed only for
   * whoever administers the organisation, and the reason a reopen demands was written and never
   * read back.
   */
  describe('the reads the screen needed', () => {
    /** Set by the log case below and reused by the projection case — periods close in order. */
    let logPeriodId = '';

    it('offers the open fiscal years, and not the closed ones', async () => {
      // Both kinds created here rather than leaning on the seeded year: cases above close periods,
      // and closing a year's LAST period closes the year — so the seeded year's status is not a
      // fixture this test may assume.
      const em = orm.em.fork();
      const company = em.getReference(Company, companyId);
      const open = em.create(FiscalYear, {
        company, year: year + 5, startDate: `${year + 5}-01-01`, endDate: `${year + 5}-12-31`,
        status: 'OPEN',
      } as never);
      const closed = em.create(FiscalYear, {
        company, year: year + 6, startDate: `${year + 6}-01-01`, endDate: `${year + 6}-12-31`,
        status: 'CLOSED',
      } as never);
      await em.flush();

      const years = await asCompany(() => periods.selectableFiscalYears());
      expect(years.map((y) => y.id)).toContain(open.id);
      expect(years.map((y) => y.id)).not.toContain(closed.id);

      const cleanup = orm.em.fork();
      await cleanup.nativeDelete(FiscalYear, { id: { $in: [open.id, closed.id] } }, FILTER_OFF);
    });

    it('keeps another company fiscal years out of the list', async () => {
      const em = orm.em.fork();
      const base = await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF);
      const other = em.create(Company, {
        code: 'FYOTHER', nameTh: 'Other', taxId: '9', branchCode: '00000',
        baseCurrency: base.baseCurrency, isActive: true, createdAt: new Date(),
      } as never);
      await em.flush();
      em.create(FiscalYear, {
        company: other, year: year + 6, startDate: `${year + 6}-01-01`, endDate: `${year + 6}-12-31`,
        status: 'OPEN',
      } as never);
      await em.flush();

      const mine = await asCompany(() => periods.selectableFiscalYears());
      expect(mine.every((y) => y.year !== year + 6)).toBe(true);
    });

    it('reads back what was done to a period, oldest first, with the reopen reason', async () => {
      const p = await declare('LOG-1', m(7, 1), m(7, 31));
      logPeriodId = p.id;
      await asCompany(() => periods.close(p.id));
      await asCompany(() => periods.reopen(p.id, 'a late vendor invoice'));
      await asCompany(() => periods.close(p.id));

      const log = await asCompany(() => periods.log(p.id));
      // Four: the declare is recorded too, and it comes first because it happened first.
      expect(log.map((e) => e.action)).toEqual([
        PeriodAction.DECLARE, PeriodAction.CLOSE, PeriodAction.REOPEN, PeriodAction.CLOSE,
      ]);
      expect(log[2].reason).toBe('a late vendor invoice');
      expect(log[2].actedBy.username).toBe('requester');
    });

    it('records the declare with the range it set', async () => {
      // This case used to assert the log was EMPTY. It was, because a declare wrote nothing — the
      // act that fixes a company's book calendar left no author and no instant.
      const p = await declare('LOG-2', m(8, 1), m(8, 31));
      const log = await asCompany(() => periods.log(p.id));

      expect(log).toHaveLength(1);
      expect(log[0].action).toBe(PeriodAction.DECLARE);
      expect(log[0].actedBy.username).toBe('requester');
      // The range, not a justification: it is the one fact about a declare worth auditing, and the
      // period row can only ever answer for its CURRENT range.
      expect(log[0].reason).toBe(`${m(8, 1)} to ${m(8, 31)}`);
    });

    it('leaves neither period nor log row when the declare fails at the flush', async () => {
      // A DUPLICATE CODE on purpose, not a bad range: every range check runs before the period row
      // is created, so a range failure never reaches the write and would not test the ordering.
      // `(company, code)` is unique, so this one fails at the flush — with the period row and the
      // log row both already staged.
      await declare('LOG-DUP', m(10, 1), m(10, 31));
      const before = (await asCompany(() => periods.list())).length;

      await expect(declare('LOG-DUP', m(11, 1), m(11, 30))).rejects.toThrow();

      expect((await asCompany(() => periods.list())).length).toBe(before);
      const em = orm.em.fork();
      const orphan = await em.find(
        AccountingPeriodLog,
        { reason: `${m(11, 1)} to ${m(11, 30)}` },
        FILTER_OFF,
      );
      expect(orphan).toEqual([]);
    });

    it('projects the actor to an id and a username, and nothing else', async () => {
      // Asserted on the KEYS: returning the AppUser would carry its email, and a later field added
      // to the entity would arrive here silently. Reads the log LOG-1 already has — declaring a
      // fresh period and closing it would be refused while LOG-2's August is still open, because
      // periods close in order.
      const [entry] = await asCompany(() => periods.log(logPeriodId));
      expect(Object.keys(entry.actedBy).sort()).toEqual(['id', 'username']);
    });

    it('refuses to read a period belonging to another company', async () => {
      const em = orm.em.fork();
      const base = await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF);
      const other = em.create(Company, {
        code: 'LOGOTHER', nameTh: 'Other', taxId: '8', branchCode: '00000',
        baseCurrency: base.baseCurrency, isActive: true, createdAt: new Date(),
      } as never);
      await em.flush();
      const otherFy = em.create(FiscalYear, {
        company: other, year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: 'OPEN',
      } as never);
      const foreign = em.create(AccountingPeriod, {
        company: other, fiscalYear: otherFy, code: 'X-LOG',
        periodStart: m(11, 1), periodEnd: m(11, 30),
        status: AccountingPeriodStatus.OPEN, createdAt: new Date(),
      } as never);
      await em.flush();

      await expect(asCompany(() => periods.log(foreign.id))).rejects.toThrow(/not found/);
    });
  });
});
