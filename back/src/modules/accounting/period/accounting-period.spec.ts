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
import { ReceivedNotInvoicedService } from '../../gl/received-not-invoiced.service';
import { GlPostingService } from '../../gl/gl-posting.service';
import { AccountRole, JournalEntry } from '../../gl/gl.entities';
import { JournalService } from '../../gl/journal.service';
import { GlPostingAttempt } from '../../gl/gl-posting.entities';
import { AccountingPeriod, AccountingPeriodLog } from './accounting-period.entities';
import { AccountingPeriodService } from './accounting-period.service';
import { PeriodGuardService } from './period-guard.service';
import type { MikroORM } from '@mikro-orm/postgresql';

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
      new AccountRoleService(orm.em),
      new PeriodGuardService(),
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
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL, amount: '1000.00', createdAt: new Date() } as never);
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
    expect(log.map((l) => l.action)).toEqual([PeriodAction.CLOSE, PeriodAction.REOPEN]);
    expect(log[1].reason).toBe('auditor found a misposting');

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
});
