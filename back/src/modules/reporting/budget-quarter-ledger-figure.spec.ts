import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  BudgetTxnType,
  ControlPolicy,
  DocCategory,
  DocStatus,
} from '../../common/enums';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import {
  Document,
  DocumentType,
  FormTemplate,
} from '../document/document.entities';
import {
  Company,
  Department,
  FiscalYear,
} from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetQuarterService } from './budget-quarter.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const YEAR = 2026;

/**
 * What the quarterly read measures a share against.
 *
 * It used to be `budget.amount_total` — the amount a budget was RAISED at, which no adjustment ever
 * moves because invariant 3 forbids rewriting it. So a budget raised at 12,000,000 and adjusted to
 * 112,004,000 through four approved documents was reported, on this screen alone, as a 12,000,000
 * budget: every share, every remainder and the overspent flag drawn against a ceiling that stopped
 * being true at the first approval, while the budget's own page showed the real figure.
 *
 * These are the cases that pin the figure to the LEDGER instead. Kept in their own file with their
 * own ledger: `budget-quarter.spec.ts` builds one fixture that every one of its 41 tests reads, and
 * adding movement types to it would move numbers those tests assert for reasons unrelated to them.
 */
describe.skipIf(!hasDb)('the annual figure comes from the ledger', () => {
  let orm: MikroORM;
  let service: BudgetQuarterService;
  let balance: BudgetBalanceService;

  const ids = { company: '', dept: '', fy: '', doc: '' };
  const budgets: Record<string, string> = {};

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const lak = em.create(Currency, {
      code: 'LAK',
      name: 'Kip',
      decimalPlaces: 0,
      isActive: true,
    });
    const company = em.create(Company, {
      code: 'L',
      nameTh: 'L',
      taxId: 'L',
      branchCode: '00000',
      baseCurrency: lak,
      timezone: 'UTC',
      isActive: true,
    });
    const dept = em.create(Department, {
      company,
      deptCode: 'DL',
      name: 'Dept L',
      isActive: true,
    });
    const fy = em.create(FiscalYear, {
      company,
      year: YEAR,
      startDate: `${YEAR}-01-01`,
      endDate: `${YEAR}-12-31`,
      status: 'OPEN',
    });
    const user = em.create(AppUser, {
      username: 'u',
      email: 'u@x',
      status: 'ACTIVE',
    });
    const wf = em.create(Workflow, { company, name: 'WF', isActive: true });
    const dt = em.create(DocumentType, {
      company,
      code: 'PR',
      name: 'PR',
      category: DocCategory.PROCUREMENT,
      requiresBudget: true,
      requiresQuota: false,
      isActive: true,
    });
    const tmpl = em.create(FormTemplate, {
      documentType: dt,
      version: 1,
      status: 'PUBLISHED',
    });
    const doc = em.create(Document, {
      docNo: 'PR-L-1',
      company,
      department: dept,
      documentType: dt,
      formTemplate: tmpl,
      workflow: wf,
      createdBy: user,
      status: DocStatus.DRAFT,
      currentStepNo: 0,
      baseTotalAmount: '0.00',
      createdAt: new Date(),
    });

    const budget = (name: string, code: string, amount: string) => {
      const bud = budgetAt(em, {
        fiscalYear: fy,
        department: dept,
        code,
        budgetName: name,
        amountTotal: amount,
        controlPolicy: ControlPolicy.HARD_STOP,
        status: 'ACTIVE',
      });
      attachCoverage(em, company, bud);
      return bud;
    };

    // The budget this change was raised from: 1.106 of the customer's ADM plan.
    const adjusted = budget('Adjusted', '1.106', '12000000');
    // Consumption only — the ceiling must not move for it.
    const spentOnly = budget('Spent only', '2.1', '100000000');
    // A transfer pair inside the same year.
    const source = budget('Transfer source', '3.1', '50000000');
    const destination = budget('Transfer destination', '3.2', '50000000');
    // Raised at nothing, adjusted upwards: NOT a zero budget any more.
    const raisedAtZero = budget('Raised at zero', '4.1', '0');
    // Q1 spend, then the ceiling doubled afterwards.
    const denominatorMoved = budget('Denominator moved', '5.1', '100000000');
    // Every movement type at once, for the agreement test.
    const everyType = budget('Every type', '6.1', '80000000');
    // A reserve dated outside the fiscal year's quarter windows.
    const outsideWindow = budget('Outside window', '7.1', '10000000');

    await em.flush();
    Object.assign(ids, {
      company: company.id,
      dept: dept.id,
      fy: fy.id,
      doc: doc.id,
    });
    Object.assign(budgets, {
      adjusted: adjusted.id,
      spentOnly: spentOnly.id,
      source: source.id,
      destination: destination.id,
      raisedAtZero: raisedAtZero.id,
      denominatorMoved: denominatorMoved.id,
      everyType: everyType.id,
      outsideWindow: outsideWindow.id,
    });

    const em2 = orm.em.fork();
    const txn = (
      budgetId: string,
      type: BudgetTxnType,
      amount: string,
      date: string,
    ) =>
      em2.create(BudgetTxn, {
        budget: em2.getReference(Budget, budgetId),
        document: em2.getReference(Document, ids.doc),
        txnType: type,
        txnDate: date,
        amount,
        createdAt: new Date(),
      } as never);

    // 1.106 as it actually stands: raised at 12,000,000, then four approved adjustments.
    txn(budgets.adjusted, BudgetTxnType.ADJUST_INCREASE, '65004000', `${YEAR}-01-15`);
    txn(budgets.adjusted, BudgetTxnType.ADJUST_INCREASE, '37000000', `${YEAR}-04-15`);
    txn(budgets.adjusted, BudgetTxnType.ADJUST_INCREASE, '1000000', `${YEAR}-07-15`);
    txn(budgets.adjusted, BudgetTxnType.ADJUST_DECREASE, '3000000', `${YEAR}-10-15`);

    txn(budgets.spentOnly, BudgetTxnType.RESERVE, '40000000', `${YEAR}-02-01`);
    txn(budgets.spentOnly, BudgetTxnType.RELEASE, '10000000', `${YEAR}-02-20`);

    txn(budgets.source, BudgetTxnType.TRANSFER_OUT, '5000000', `${YEAR}-03-01`);
    txn(budgets.destination, BudgetTxnType.TRANSFER_IN, '5000000', `${YEAR}-03-01`);

    txn(budgets.raisedAtZero, BudgetTxnType.ADJUST_INCREASE, '20000000', `${YEAR}-01-10`);
    txn(budgets.raisedAtZero, BudgetTxnType.RESERVE, '5000000', `${YEAR}-02-10`);

    txn(budgets.denominatorMoved, BudgetTxnType.RESERVE, '50000000', `${YEAR}-02-10`);
    txn(budgets.denominatorMoved, BudgetTxnType.ADJUST_INCREASE, '100000000', `${YEAR}-08-10`);

    // Activation-sized adjustment, one back down, a transfer both ways, a reserve, a release, and
    // an ACTUAL that settles part of the reserve and must move nothing.
    txn(budgets.everyType, BudgetTxnType.ADJUST_INCREASE, '20000000', `${YEAR}-01-05`);
    txn(budgets.everyType, BudgetTxnType.ADJUST_DECREASE, '5000000', `${YEAR}-01-06`);
    txn(budgets.everyType, BudgetTxnType.TRANSFER_IN, '7000000', `${YEAR}-02-05`);
    txn(budgets.everyType, BudgetTxnType.TRANSFER_OUT, '2000000', `${YEAR}-02-06`);
    txn(budgets.everyType, BudgetTxnType.RESERVE, '30000000', `${YEAR}-05-05`);
    txn(budgets.everyType, BudgetTxnType.RELEASE, '4000000', `${YEAR}-05-20`);
    txn(budgets.everyType, BudgetTxnType.ACTUAL, '12000000', `${YEAR}-06-05`);

    // Dated a year later — outside every quarter window this fiscal year has.
    txn(budgets.outsideWindow, BudgetTxnType.RESERVE, '1000000', `${YEAR + 1}-02-01`);

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
    RequestContext.run(
      { userId: 'u', companyId: ids.company, departmentId: ids.dept, grants: [] },
      () => service.byQuarter(ids.fy),
    );

  const rowFor = async (budgetId: string) => {
    const out = await report();
    const row = out.departments
      .flatMap((d) => d.budgets)
      .find((b) => b.budgetId === budgetId);
    expect(row, `no row for budget ${budgetId}`).toBeDefined();
    return row!;
  };

  it('reports the adjusted ceiling, not the amount the budget was raised at', async () => {
    const row = await rowFor(budgets.adjusted);
    expect(row.amountTotal).toBe('112004000');
    expect(row.yearConsumed).toBe('0');
    expect(row.remaining).toBe('112004000');
  });

  it('does not let consumption raise or lower the ceiling', async () => {
    const row = await rowFor(budgets.spentOnly);
    expect(row.amountTotal).toBe('100000000');
    expect(row.yearConsumed).toBe('30000000');
    expect(row.remaining).toBe('70000000');
  });

  it('moves the ceiling on both sides of a transfer', async () => {
    const out = await report();
    const rows = out.departments.flatMap((d) => d.budgets);
    const src = rows.find((b) => b.budgetId === budgets.source)!;
    const dst = rows.find((b) => b.budgetId === budgets.destination)!;
    expect(src.amountTotal).toBe('45000000');
    expect(dst.amountTotal).toBe('55000000');
  });

  it('treats a budget raised at zero and adjusted upwards as a real budget', async () => {
    const row = await rowFor(budgets.raisedAtZero);
    expect(row.amountTotal).toBe('20000000');
    expect(row.yearUtilizationPct).toBe(25);
    expect(row.overspent).toBe(false);
  });

  it('draws a quarter share against the ceiling as it now stands', async () => {
    const row = await rowFor(budgets.denominatorMoved);
    expect(row.amountTotal).toBe('200000000');
    // 50,000,000 of 200,000,000 — a quarter, not the half it was before the adjustment.
    expect(row.quarters[0].utilizationPct).toBe(25);
    expect(row.yearUtilizationPct).toBe(25);
  });

  it('states the same balance the budget page states', async () => {
    const row = await rowFor(budgets.everyType);
    const available = await RequestContext.run(
      { userId: 'u', companyId: ids.company, departmentId: ids.dept, grants: [] },
      () => balance.availableBalance(budgets.everyType),
    );
    // The whole point: two reads over the same ledger, one number.
    expect(row.remaining).toBe(available);
    // 80,000,000 + 20,000,000 − 5,000,000 + 7,000,000 − 2,000,000 = 100,000,000 ceiling,
    // consumed 30,000,000 − 4,000,000 = 26,000,000. ACTUAL settles, and moves neither.
    expect(row.amountTotal).toBe('100000000');
    expect(row.yearConsumed).toBe('26000000');
  });

  it('lifts a row out of overspend when the adjustment covers the spend', async () => {
    // The shape 1.106 lands in once its expenditure is imported: consumed to the last kip of a
    // ceiling that was adjusted up to meet it. Exactly spent is NOT overspent.
    const row = await rowFor(budgets.spentOnly);
    expect(
      Number(row.amountTotal) - Number(row.yearConsumed) - Number(row.remaining),
    ).toBe(0);
    expect(row.overspent).toBe(false);
  });

  it('carries the same figures on a department as on the lines beneath it', async () => {
    const out = await report();
    for (const d of out.departments) {
      const sum = (pick: (b: (typeof d.budgets)[number]) => string) =>
        d.budgets.reduce((s, b) => s + Number(pick(b)), 0);
      expect(Number(d.amountTotal)).toBe(sum((b) => b.amountTotal));
      expect(Number(d.remaining)).toBe(sum((b) => b.remaining));
      expect(Number(d.yearConsumed)).toBe(sum((b) => b.yearConsumed));
    }
  });

  it('counts a row outside every quarter window in the ceiling, not in consumption', async () => {
    // Pinned rather than left to chance: the fold walks every row of the budget, while the quarter
    // attribution only owns rows a window contains. A budget belongs to one fiscal year and its
    // movements sit inside it, so this is a shape the data should not take — but if it does, the
    // read must be readable about it rather than quietly wrong in an unknown direction.
    const row = await rowFor(budgets.outsideWindow);
    expect(row.yearConsumed).toBe('0');
    expect(row.remaining).toBe('9000000');
    // Ceiling = remaining + what the year consumed, and the year consumed none of it.
    expect(row.amountTotal).toBe('9000000');
  });
});
