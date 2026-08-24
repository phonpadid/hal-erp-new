import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { ReportingController } from './reporting.controller';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType, ControlPolicy, DocCategory, DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetQuarterService } from './budget-quarter.service';
import type { MikroORM } from '@mikro-orm/postgresql';

// --- Permission gate: the same code the other budget reports carry (no DB needed) -----------
describe('GET /reports/budget-by-quarter permission gate', () => {
  const guard = new PermissionsGuard(new Reflector());
  const handler = ReportingController.prototype.budgetByQuarter;
  const ctx = (permissionCodes: string[]) =>
    ({
      getHandler: () => handler,
      getClass: () => ReportingController,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
    }) as never;

  it('allows REPORT_VIEW', () => {
    expect(guard.canActivate(ctx(['REPORT_VIEW']))).toBe(true);
  });

  it('denies a user without it', () => {
    expect(() => guard.canActivate(ctx(['BUDGET_VIEW']))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx([]))).toThrow(ForbiddenException);
  });
});

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;
const YEAR = 2026;

/**
 * The quarterly read, against a ledger this spec places itself.
 *
 * Nothing here depends on the spend-history import, which does not exist. Every figure is written
 * where the test wants it, which is the only way to exercise a quarter boundary at all.
 */
describe.skipIf(!hasDb)('budget consumption by quarter (DB-backed)', () => {
  let orm: MikroORM;
  let service: BudgetQuarterService;
  let balance: BudgetBalanceService;
  const ids = { companyA: '', companyB: '', deptA: '', deptB: '', fyA: '', fyB: '', doc: '', docB: '' };
  const budgets: Record<string, string> = {};

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });

    const mk = (code: string, tz = 'UTC') => {
      const company = em.create(Company, { code, nameTh: code, taxId: code, branchCode: '00000', baseCurrency: lak, timezone: tz, isActive: true });
      const dept = em.create(Department, { company, deptCode: `D${code}`, name: `Dept ${code}`, isActive: true });
      const fy = em.create(FiscalYear, { company, year: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, status: 'OPEN' });
      const wf = em.create(Workflow, { company, name: `WF${code}`, isActive: true });
      const dt = em.create(DocumentType, { company, code: 'PR', name: 'PR', category: DocCategory.PROCUREMENT, requiresBudget: true, requiresQuota: false, isActive: true });
      const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, status: 'PUBLISHED' });
      const doc = em.create(Document, {
        docNo: `PR-${code}-1`, company, department: dept, documentType: dt, formTemplate: tmpl,
        workflow: wf, createdBy: user, status: DocStatus.DRAFT, currentStepNo: 0,
        baseTotalAmount: '0.00', createdAt: new Date(),
      });
      return { company, dept, fy, doc };
    };
    const user = em.create(AppUser, { username: 'u', email: 'u@x', status: 'ACTIVE' });
    const a = mk('A');
    const b = mk('B');

    const budget = (name: string, code: string, amount: string, of = a) => {
      const bud = budgetAt(em, {
        fiscalYear: of.fy, department: of.dept, code, budgetName: name,
        amountTotal: amount, controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE',
      });
      attachCoverage(em, of.company, bud);
      return bud;
    };
    const straddle = budget('Straddle', '1.1', '1000000');
    const steady = budget('Steady', '1.2', '1000000');
    const zero = budget('Zero budget', '1.3', '0');
    const foreign = budget('Foreign', '9.9', '500000', b);

    await em.flush();
    Object.assign(ids, {
      companyA: a.company.id, companyB: b.company.id, deptA: a.dept.id, deptB: b.dept.id,
      fyA: a.fy.id, fyB: b.fy.id, doc: a.doc.id, docB: b.doc.id,
    });
    Object.assign(budgets, { straddle: straddle.id, steady: steady.id, zero: zero.id, foreign: foreign.id });

    const em2 = orm.em.fork();
    const txn = (budgetId: string, type: BudgetTxnType, amount: string, date: string, docId = ids.doc) =>
      em2.create(BudgetTxn, {
        budget: em2.getReference(Budget, budgetId), document: em2.getReference(Document, docId),
        txnType: type, txnDate: date, amount, createdAt: new Date(),
      } as never);

    // STRADDLE: committed 100,000 in Q2, gave 30,000 back in Q3. The release belongs to Q2.
    txn(budgets.straddle, BudgetTxnType.RESERVE, '100000', `${YEAR}-05-20`);
    txn(budgets.straddle, BudgetTxnType.RELEASE, '30000', `${YEAR}-07-04`);
    // STEADY: one reserve in each of Q1 and Q2, plus an ACTUAL that must not be counted again.
    txn(budgets.steady, BudgetTxnType.RESERVE, '100000', `${YEAR}-02-10`);
    txn(budgets.steady, BudgetTxnType.RESERVE, '120000', `${YEAR}-05-10`);
    txn(budgets.steady, BudgetTxnType.ACTUAL, '90000', `${YEAR}-06-01`);
    // ZERO: a budget of nothing, spent against.
    txn(budgets.zero, BudgetTxnType.RESERVE, '75000', `${YEAR}-02-01`);
    // Another company's ledger, which must never appear.
    txn(budgets.foreign, BudgetTxnType.RESERVE, '400000', `${YEAR}-02-01`, ids.docB);
    await em2.flush();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(() => {
    service = new BudgetQuarterService(orm.em);
    balance = new BudgetBalanceService(orm.em);
  });

  const report = () =>
    RequestContext.run({ userId: 'u', companyId: ids.companyA, departmentId: ids.deptA, grants: [] }, () =>
      service.byQuarter(ids.fyA),
    );
  const rowOf = async (code: string) => {
    const r = await report();
    return r.departments.flatMap((d) => d.budgets).find((b) => b.code === code)!;
  };

  it('reports what each quarter consumed', async () => {
    const steady = await rowOf('1.2');
    expect(steady.quarters.map((q) => Number(q.consumed))).toEqual([100000, 120000, 0, 0]);
  });

  it('does not count an ACTUAL again — it draws down a reserve already counted', async () => {
    // Invariant 3. `reserved + actual` would report 310,000 for a budget that has seen 220,000 move.
    const steady = await rowOf('1.2');
    const year = steady.quarters.reduce((s, q) => s + Number(q.consumed), 0);
    expect(year).toBe(220000);
  });

  it('returns a release to the quarter that committed it', async () => {
    // Reserved 100,000 in Q2, released 30,000 in Q3. Q2 keeps 70,000 and Q3 shows nothing.
    const straddle = await rowOf('1.1');
    expect(straddle.quarters.map((q) => Number(q.consumed))).toEqual([0, 70000, 0, 0]);
  });

  it('never reports a negative quarter', async () => {
    const r = await report();
    const all = r.departments.flatMap((d) => [...d.quarters, ...d.budgets.flatMap((b) => b.quarters)]);
    expect(all.every((q) => Number(q.consumed) >= 0)).toBe(true);
  });

  it('the four quarters sum to what the annual read calls consumed', async () => {
    // The reconciliation that keeps this honest. If these ever diverge, one of the two is wrong.
    const r = await report();
    for (const d of r.departments) {
      for (const b of d.budgets) {
        const bd = await balance.breakdown(b.budgetId);
        const annual = Number(bd.reserved) - Number(bd.released);
        const quarterly = b.quarters.reduce((s, q) => s + Number(q.consumed), 0);
        expect(quarterly).toBe(annual);
      }
    }
  });

  it('never shows another company budget', async () => {
    const r = await report();
    const codes = r.departments.flatMap((d) => d.budgets.map((b) => b.code));
    expect(codes).not.toContain('9.9');
    expect(codes).toEqual(expect.arrayContaining(['1.1', '1.2', '1.3']));
  });

  // ---- comparison ------------------------------------------------------------------------

  it('compares a quarter with the one before it', async () => {
    const steady = await rowOf('1.2');
    const q2 = steady.quarters[1];
    expect(Number(q2.changeAmount)).toBe(20000);
    expect(q2.changePct).toBe(20);
    expect(q2.noComparison).toBeNull();
  });

  it('says there is no earlier quarter rather than leaving Q1 blank', async () => {
    // A blank cell reads equally as "still loading" and as "zero". This happens once in the life
    // of the system and cures itself when the next year has a predecessor.
    const steady = await rowOf('1.2');
    expect(steady.quarters[0].noComparison).toBe('NO_EARLIER_QUARTER');
    expect(steady.quarters[0].changePct).toBeNull();
  });

  it('labels a line that stopped instead of scoring it −100%', async () => {
    // 27–40% of this customer's lines stop between quarters — an annual licence, a New Year party.
    const steady = await rowOf('1.2');
    expect(steady.quarters[2].noComparison).toBe('STOPPED');
    expect(steady.quarters[2].changePct).toBeNull();
  });

  it('says a quarter has not started, rather than calling it stopped', async () => {
    // Found by driving the screen: Q4 of a year still in Q3 netted zero against zero and read
    // "stopped", which is arithmetically right and says the opposite of what is true.
    const steady = await rowOf('1.2');
    const future = steady.quarters.find((q) => q.elapsedDays === 0);
    expect(future).toBeDefined();
    expect(future!.noComparison).toBe('NOT_STARTED');
    expect(future!.changePct).toBeNull();
  });

  it('labels a DEPARTMENT quarter the same way as the lines beneath it', async () => {
    // The roll-up carried its own copy of the labelling rule, so a quarter the year had not
    // reached read "not started" on the budget rows and "stopped" on the department above them —
    // on the same screen, in the same column. One rule now decides both.
    const r = await report();
    for (const d of r.departments) {
      d.quarters.forEach((q, i) => {
        if (q.noComparison !== 'NOT_STARTED') return;
        expect(d.budgets.every((b) => b.quarters[i].noComparison === 'NOT_STARTED')).toBe(true);
      });
      const notStarted = d.quarters.filter((q) => q.noComparison === 'NOT_STARTED');
      expect(notStarted.length).toBeGreaterThan(0);
    }
  });

  it('labels a line that started instead of dividing by zero', async () => {
    const straddle = await rowOf('1.1');
    expect(straddle.quarters[1].noComparison).toBe('STARTED');
    expect(straddle.quarters[1].changePct).toBeNull();
  });

  it('compares an unfinished quarter over the same elapsed window, not against the whole', async () => {
    // The decision that keeps this report believable. Their own data ran out on 10 August and
    // whole-quarter arithmetic called it a 63% collapse; over the same window it was −0.1%.
    //
    // Built to be unmistakable: Q2 spent 100,000 early and 900,000 late; Q3 has spent 110,000 so
    // far. Compared whole that is −89%. Compared over the days that have actually passed it is
    // +10% — and the second is the one a budget holder can act on.
    const em = orm.em.fork();
    const paced = budgetAt(em, {
      fiscalYear: em.getReference(FiscalYear, ids.fyA), department: em.getReference(Department, ids.deptA),
      code: '2.1', budgetName: 'Paced', amountTotal: '5000000', status: 'ACTIVE',
    });
    await em.persistAndFlush(paced);
    const txn = (amount: string, date: string) =>
      em.create(BudgetTxn, {
        budget: paced, document: em.getReference(Document, ids.doc),
        txnType: BudgetTxnType.RESERVE, txnDate: date, amount, createdAt: new Date(),
      } as never);
    txn('100000', `${YEAR}-04-10`); // Q2 day 10 — inside any elapsed window worth comparing
    txn('900000', `${YEAR}-06-20`); // Q2 day 81 — beyond it
    txn('110000', `${YEAR}-07-10`); // Q3 day 10
    await em.flush();

    const row = await rowOf('2.1');
    const q3 = row.quarters[2];
    expect(q3.complete).toBe(false);
    expect(q3.elapsedDays).toBeLessThan(q3.days);
    // Compared against Q2's SAME window (100,000), not against all of Q2 (1,000,000).
    expect(Number(q3.previousConsumed)).toBe(100000);
    expect(Number(q3.changeAmount)).toBe(10000);
    expect(q3.changePct).toBe(10);
    // The figure the whole-quarter comparison would have produced, stated so the difference is
    // visible in the test rather than only in the design.
    expect(Math.round(((110000 - 1000000) / 1000000) * 1000) / 10).toBe(-89);
  });

  it('compares a finished quarter whole', async () => {
    // The elapsed-window rule must not follow a quarter into the past: Q2 is over, so its
    // comparison against Q1 uses all of both.
    const row = await rowOf('2.1');
    const q2 = row.quarters[1];
    expect(q2.complete).toBe(true);
    expect(Number(q2.consumed)).toBe(1000000);
  });

  // ---- zero budgets ----------------------------------------------------------------------

  it('reports no percentage for a budget of zero, and marks it overspent', async () => {
    const zero = await rowOf('1.3');
    expect(zero.yearUtilizationPct).toBeNull();
    expect(zero.overspent).toBe(true);
    expect(Number(zero.quarters[0].consumed)).toBe(75000);
  });

  it('does not mark an untouched zero budget as overspent', async () => {
    const em = orm.em.fork();
    const untouched = budgetAt(em, {
      fiscalYear: em.getReference(FiscalYear, ids.fyA), department: em.getReference(Department, ids.deptA),
      code: '1.4', budgetName: 'Untouched zero', amountTotal: '0', status: 'ACTIVE',
    });
    await em.persistAndFlush(untouched);
    const row = await rowOf('1.4');
    expect(row.yearUtilizationPct).toBeNull();
    expect(row.overspent).toBe(false);
  });

  // ---- the report as a whole --------------------------------------------------------------

  it('groups by department with the budgets beneath', async () => {
    const r = await report();
    expect(r.departments).toHaveLength(1);
    expect(r.departments[0].departmentId).toBe(ids.deptA);
    expect(r.departments[0].budgets.length).toBeGreaterThanOrEqual(3);
  });

  it('a department quarter equals the sum of its budgets', async () => {
    const r = await report();
    for (const d of r.departments) {
      d.quarters.forEach((q, i) => {
        const sum = d.budgets.reduce((s, b) => s + Number(b.quarters[i].consumed), 0);
        expect(Number(q.consumed)).toBe(sum);
      });
    }
  });

  it('reports the day it was measured on', async () => {
    const r = await report();
    expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.year).toBe(YEAR);
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-quarter] no database reachable — skipping');
}
