import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { budgetTxnDirection } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { localDateIn } from '../../common/time/company-clock';
import {
  attributeMonths,
  attributeQuarters,
  elapsedDays,
  monthsOf,
  quartersOf,
} from '../budget/budget-period';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { FiscalYear } from '../multi-company/multi-company.entities';
import type {
  AttributableTxn,
  MonthIndex,
  MonthWindow,
  QuarterIndex,
} from '../budget/budget-period';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * What the single pass over the ledger produced, carried to the per-row figures.
 *
 * One object rather than eleven positional arguments: the figures a row needs all come from the
 * same scan, and threading them separately is how one of them gets passed in the wrong order.
 */
interface Scan {
  windows: ReturnType<typeof quartersOf>;
  monthWindows: MonthWindow[];
  asOf: string;
  openQuarter: QuarterIndex | undefined;
  openElapsed: number;
  consumed: Map<string, string>;
  consumedWithin: Map<string, string>;
  consumedByMonth: Map<string, string>;
}

/**
 * Why a quarter cannot be compared with the one before it.
 *
 * `NO_ACTIVITY` and `STOPPED` are deliberately distinct, and so are `NO_ACTIVITY` and
 * `NOT_STARTED`. "Stopped" asserts that spending ran and ceased; "not started" says the calendar
 * has not arrived. A line that has simply never been spent against in a quarter the year HAS
 * reached is neither, and calling it stopped — which is what zero-against-zero used to fall
 * through to — describes a spending pattern that never existed.
 */
export type NoComparison =
  | 'STARTED'
  | 'STOPPED'
  | 'NO_ACTIVITY'
  | 'NO_EARLIER_QUARTER'
  | 'NOT_STARTED';

/** One month inside a quarter: an amount and nothing else. */
export interface MonthFigure {
  /** The month's POSITION in the fiscal year, 1–12 — never a calendar month. */
  month: MonthIndex;
  /** `Σ RESERVE − Σ RELEASE` for the month, on the same terms as its quarter. */
  consumed: string;
}

export interface QuarterFigure {
  quarter: QuarterIndex;
  /** `Σ RESERVE − Σ RELEASE`, the releases attributed to the quarter that committed them. */
  consumed: string;
  /** The three months this quarter contains. They sum to `consumed`, by construction. */
  months: MonthFigure[];
  /**
   * The quarter's share of the ANNUAL budget. Null where there is no budget to take a share of —
   * there is no per-quarter budget in this system, and this read does not invent one.
   */
  utilizationPct: number | null;
  /** Days of the quarter that have passed on the company's day. Equals `days` once it has ended. */
  elapsedDays: number;
  days: number;
  complete: boolean;
  /** Change against the previous quarter, over the same elapsed window when this one is open. */
  changeAmount: string | null;
  /** Percentage change, one decimal. Null whenever one side consumed nothing. */
  changePct: number | null;
  /** Set when `changePct` is null, saying which side is missing. */
  noComparison: NoComparison | null;
  /** What the previous quarter consumed over the window this was compared against. */
  previousConsumed: string | null;
}

export interface BudgetQuarterRow {
  budgetId: string;
  code: string;
  budgetName: string;
  departmentId: string;
  departmentName: string;
  /**
   * The budget AS IT NOW STANDS, not the amount it was raised at: `budget.amount_total` with every
   * `ADJUST_INCREASE` and `TRANSFER_IN` added and every `ADJUST_DECREASE` and `TRANSFER_OUT` taken
   * off. Consumption is measured against this, and `remaining` is this minus it.
   */
  amountTotal: string;
  quarters: QuarterFigure[];
  /** What the year consumed — the sum of the four quarters, so the two can never disagree. */
  yearConsumed: string;
  /** `amount_total − yearConsumed`. Left NEGATIVE when overspent; that is the fact. */
  remaining: string;
  /** Null when there is no budget to measure against — never 0, which reads as untouched. */
  yearUtilizationPct: number | null;
  /** `100 − yearUtilizationPct`, and null wherever that is — there is no remainder of nothing. */
  remainingPct: number | null;
  overspent: boolean;
}

export interface BudgetQuarterDepartment {
  departmentId: string;
  departmentName: string;
  /** The sum of its lines' — the same ledger figure, never a separately derived one. */
  amountTotal: string;
  quarters: QuarterFigure[];
  yearConsumed: string;
  remaining: string;
  yearUtilizationPct: number | null;
  remainingPct: number | null;
  overspent: boolean;
  budgets: BudgetQuarterRow[];
}

/** A fiscal year the report can be run for. */
export interface FiscalYearRef {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
}

/** A department the report COULD be run for — not necessarily one in the current result. */
export interface DepartmentOption {
  id: string;
  name: string;
}

export interface BudgetQuarterReport {
  fiscalYearId: string;
  year: number;
  /** The company day the elapsed figures were measured on. */
  asOf: string;
  /**
   * The years this report can be run for — returned here because `/fiscal-years` is admin-gated
   * and this report is not. A reader allowed to run it must not need an administrator's permission
   * to discover which years they may run it for.
   */
  fiscalYears: FiscalYearRef[];
  /**
   * Every department the reported year holds a budget for, resolved BEFORE any filter narrows the
   * result. Kept apart from `departments`, which carries the ROWS and legitimately holds one when a
   * department is chosen: one field with both meanings is how a picker ends up filtering itself out
   * of existence and stranding the reader with no way back.
   */
  departmentOptions: DepartmentOption[];
  departments: BudgetQuarterDepartment[];
}

/**
 * Budget consumption by quarter of a fiscal year.
 *
 * Consumption is `Σ RESERVE − Σ RELEASE`, the same definition the annual utilization read uses, so
 * the two can never disagree — a test asserts the four quarters sum to it. The quarter a row
 * belongs to is decided in `budget-period.ts`, which returns a release to the quarter of the
 * reserve it gives back rather than to its own date.
 *
 * Every figure comes from ONE pass over the ledger. The obvious implementation is a loop over
 * quarters, and this report runs over every document the company will ever raise.
 */
@Injectable()
export class BudgetQuarterService {
  constructor(private readonly em: EntityManager) {}

  async byQuarter(
    fiscalYearId?: string,
    departmentId?: string,
  ): Promise<BudgetQuarterReport> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();

    const fy = await em.findOne(
      FiscalYear,
      fiscalYearId
        ? { id: fiscalYearId, company: companyId }
        : { company: companyId },
      { ...FILTER_OFF, populate: ['company'], orderBy: { year: 'DESC' } },
    );
    if (!fy)
      throw new NotFoundException(
        'No fiscal year to report on in the active company',
      );

    // The company's day, not the server's — the same reason `budget_txn.txn_date` exists. "How
    // much of this quarter has passed" is a question about the company's calendar.
    const asOf = localDateIn(new Date(), fy.company.timezone ?? 'UTC');
    const windows = quartersOf(fy.startDate);

    // What the report COULD be run for, resolved BEFORE the filters narrow anything. Neither list
    // may be derived from `budgets` below: that query carries `where.department` under a filter, so
    // the department list would collapse to the one department already chosen and strand the reader
    // with no way back. Two small indexed lookups; neither touches `budget_txn`.
    const [fiscalYears, departmentOptions] = await Promise.all([
      this.yearsOf(em, companyId),
      this.departmentsOf(em, fy.id),
    ]);

    const where: Record<string, unknown> = { fiscalYear: fy.id };
    if (departmentId) where.department = departmentId;
    const budgets = await em.find(Budget, where, {
      ...FILTER_OFF,
      populate: ['department', 'node'],
      orderBy: { node: { code: 'ASC' } },
    });
    if (!budgets.length) {
      // Still carries both lists: a year holding nothing must still offer the years that do.
      return {
        fiscalYearId: fy.id,
        year: fy.year,
        asOf,
        fiscalYears,
        departmentOptions,
        departments: [],
      };
    }

    // One scan. Every row of every budget in the year, then grouped in memory.
    const txns = await em.find(
      BudgetTxn,
      { budget: { $in: budgets.map((b) => b.id) } },
      { ...FILTER_OFF, populate: ['budget', 'document'] },
    );
    const attributable: AttributableTxn[] = txns.map((t) => ({
      documentId: t.document.id,
      budgetId: t.budget.id,
      txnType: t.txnType,
      txnDate: t.txnDate,
      amount: t.amount,
    }));
    const quarterOfTxn = attributeQuarters(fy.startDate, attributable);
    // Both attributions come off the same `(document, budget)` reserve lookup, so a release lands
    // in ONE quarter and in a month INSIDE that quarter. That is what lets three months sum to it.
    const monthOfTxn = attributeMonths(fy.startDate, attributable);
    const monthWindows = monthsOf(fy.startDate);

    // consumed per (budget, quarter), and per (budget, quarter) restricted to the first N days —
    // the second is what an unfinished quarter is compared against.
    const consumed = new Map<string, string>();
    const consumedWithin = new Map<string, string>();
    // ...and per (budget, month), filled in the SAME pass. A second query grouping by month would
    // re-derive attribution in SQL, put a release in its own month, and stop the months adding up.
    const consumedByMonth = new Map<string, string>();
    const key = (budgetId: string, q: QuarterIndex) => `${budgetId}:${q}`;
    const monthKey = (budgetId: string, m: MonthIndex) => `${budgetId}:m${m}`;

    const openQuarter = windows.find((w) => asOf >= w.start && asOf <= w.end);
    const openElapsed = openQuarter ? elapsedDays(openQuarter, asOf) : 0;

    // Seeded with the column, then moved by every row below. `budget.amount_total` is the amount
    // the budget was RAISED at and nothing rewrites it (invariant 3), so on its own it is not the
    // money a budget has — which is what this report used to measure every share against.
    const balance = new Map<string, string>(
      budgets.map((b) => [b.id, b.amountTotal]),
    );

    for (const t of attributable) {
      // Fold FIRST, and outside the quarter attribution: an adjustment belongs to the budget, not
      // to a quarter, and `quarterOfTxn` deliberately holds only the rows a quarter can own. The
      // direction is read from the one shared classification the balance service reads — it was
      // spelled out in five places once, and the fifth drew a settlement as a withdrawal.
      const held = balance.get(t.budgetId);
      if (held !== undefined) {
        switch (budgetTxnDirection(t.txnType)) {
          case 'ADDS':
            balance.set(t.budgetId, Money.add(held, t.amount));
            break;
          case 'SUBTRACTS':
            balance.set(t.budgetId, Money.subtract(held, t.amount));
            break;
          case 'CONVERTS':
            break; // ACTUAL settles a reserve already taken out; counting it charges twice
        }
      }

      const q = quarterOfTxn.get(t);
      if (!q) continue;
      const signed =
        t.txnType === BudgetTxnType.RESERVE
          ? t.amount
          : t.txnType === BudgetTxnType.RELEASE
            ? `-${t.amount}`
            : null;
      if (signed === null) continue; // ACTUAL draws down a reserve already counted (invariant 3)
      const k = key(t.budgetId, q);
      consumed.set(k, Money.add(consumed.get(k) ?? '0', signed));

      const m = monthOfTxn.get(t);
      if (m) {
        const mk = monthKey(t.budgetId, m);
        consumedByMonth.set(
          mk,
          Money.add(consumedByMonth.get(mk) ?? '0', signed),
        );
      }

      // Same-window figure: is this row inside the first `openElapsed` days of ITS quarter?
      if (openQuarter) {
        const w = windows[q - 1];
        const day = elapsedDays(w, t.txnDate);
        if (day > 0 && day <= openElapsed) {
          consumedWithin.set(
            k,
            Money.add(consumedWithin.get(k) ?? '0', signed),
          );
        }
      }
    }

    const scan: Scan = {
      windows,
      monthWindows,
      asOf,
      openQuarter: openQuarter?.quarter,
      openElapsed,
      consumed,
      consumedWithin,
      consumedByMonth,
    };

    // What a budget has LEFT is `balance` — the invariant-3 figure the budget's own detail page
    // shows. What a share is drawn against is that plus what the year consumed: the two together
    // are the budget as it now stands, and `remaining` computed back off it in `yearFigures` lands
    // on `balance` exactly. Reading `amount_total` here instead — which is what this did — measured
    // every share and every remainder against a number no adjustment ever moves, and put this
    // screen at odds with the budget's own page over the same rows.
    const rows: BudgetQuarterRow[] = budgets.map((b) => {
      // Summed from the same map `figureFor` reads, so this cannot disagree with the per-quarter
      // figures; `yearFigures` re-sums it from the quarters, which is the property the spec asks
      // for and is the same number by construction.
      const yearConsumed = windows.reduce(
        (s, w) => Money.add(s, consumed.get(key(b.id, w.quarter)) ?? '0'),
        '0',
      );
      const annual = Money.add(balance.get(b.id) ?? b.amountTotal, yearConsumed);
      const quarters = windows.map((w) => this.figureFor(b.id, annual, w, scan));
      return {
        budgetId: b.id,
        code: b.node.code,
        budgetName: b.budgetName ?? b.node.name ?? b.node.code,
        departmentId: b.department.id,
        departmentName: b.department.name,
        amountTotal: annual,
        quarters,
        ...this.yearFigures(annual, quarters),
      };
    });

    return {
      fiscalYearId: fy.id,
      year: fy.year,
      asOf,
      fiscalYears,
      departmentOptions,
      departments: this.rollUp(rows, windows),
    };
  }

  /**
   * The fiscal years of the active company, newest first.
   *
   * Returned with the report because `/fiscal-years` is authorized for administrators while this
   * report is authorized by the budget-reporting permission code. A reader allowed to run the
   * report must not need an administrator's permission to discover which years they may run it for.
   */
  private async yearsOf(
    em: EntityManager,
    companyId: string,
  ): Promise<FiscalYearRef[]> {
    const years = await em.find(
      FiscalYear,
      { company: companyId },
      { ...FILTER_OFF, orderBy: { year: 'DESC' } },
    );
    return years.map((y) => ({
      id: y.id,
      year: y.year,
      startDate: y.startDate,
      endDate: y.endDate,
    }));
  }

  /**
   * Every department the given fiscal year holds a budget for, by name.
   *
   * Its own query, deliberately: the budgets loaded for the report are narrowed by `departmentId`,
   * so reusing them would offer the reader only the department they had already chosen. Distinct
   * departments of one year's budgets — an indexed lookup, and nothing to do with `budget_txn`.
   */
  private async departmentsOf(
    em: EntityManager,
    fiscalYearId: string,
  ): Promise<DepartmentOption[]> {
    const budgets = await em.find(
      Budget,
      { fiscalYear: fiscalYearId },
      { ...FILTER_OFF, populate: ['department'], fields: ['department'] },
    );
    const byId = new Map<string, string>();
    for (const b of budgets) byId.set(b.department.id, b.department.name);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * How a quarter compares with the one before it — the ONE place that decides it.
   *
   * The department roll-up used to carry its own copy of this, which is how a quarter the year had
   * not reached kept reading "stopped" on the department rows for a while after the per-budget rows
   * were fixed. Two places computing one rule is the defect; this is the repair.
   */
  private compare(
    mine: string,
    previous: string | null,
    notStarted: boolean,
  ): Pick<QuarterFigure, 'changeAmount' | 'changePct' | 'noComparison'> {
    if (notStarted)
      return {
        changeAmount: null,
        changePct: null,
        noComparison: 'NOT_STARTED',
      };
    if (previous === null) {
      return {
        changeAmount: null,
        changePct: null,
        noComparison: 'NO_EARLIER_QUARTER',
      };
    }
    const changeAmount = Money.subtract(mine, previous);
    const prevZero = Money.compare(previous, '0') === 0;
    const mineZero = Money.compare(mine, '0') === 0;
    // Ordered before STOPPED, which is what nothing-against-nothing used to fall through to. On the
    // customer's own data that put `ຢຸດໃຊ້` — stopped — on every quarter of every line that has
    // never been spent against, asserting a run that never happened.
    if (prevZero && mineZero)
      return { changeAmount, changePct: null, noComparison: 'NO_ACTIVITY' };
    if (prevZero)
      return { changeAmount, changePct: null, noComparison: 'STARTED' };
    if (mineZero)
      return { changeAmount, changePct: null, noComparison: 'STOPPED' };
    return {
      changeAmount,
      changePct:
        Math.round((Number(changeAmount) / Number(previous)) * 1000) / 10,
      noComparison: null,
    };
  }

  /**
   * A budget's figure for one quarter, and its comparison with the quarter before it.
   *
   * An unfinished quarter is compared over the SAME elapsed window of the previous one. Compared
   * whole it reads as a collapse that is only the calendar not having caught up — 40 days of a
   * 92-day quarter against a full one reports −63% while the truth is −0.1%.
   */
  private figureFor(
    budgetId: string,
    annualBudget: string,
    w: { quarter: QuarterIndex; days: number; start: string; end: string },
    scan: Scan,
  ): QuarterFigure {
    const { asOf, consumed, consumedWithin, consumedByMonth, monthWindows } =
      scan;
    const k = (q: QuarterIndex) => `${budgetId}:${q}`;
    const mine = consumed.get(k(w.quarter)) ?? '0';
    const isOpen = scan.openQuarter === w.quarter;
    const elapsed =
      asOf > w.end
        ? w.days
        : isOpen
          ? scan.openElapsed
          : asOf < w.start
            ? 0
            : w.days;

    const prevIndex = (w.quarter - 1) as QuarterIndex;
    const hasPrev = w.quarter > 1;
    // The previous quarter over the same window when this one is open; whole otherwise.
    const prev = !hasPrev
      ? null
      : isOpen
        ? (consumedWithin.get(k(prevIndex)) ?? '0')
        : (consumed.get(k(prevIndex)) ?? '0');

    // The three months of THIS quarter, in order. They sum to `mine` because a row's month always
    // sits inside the quarter that row was filed in — see `attributeBy` in `budget-period.ts`.
    const months: MonthFigure[] = monthWindows
      .filter((m) => m.quarter === w.quarter)
      .map((m) => ({
        month: m.month,
        consumed: consumedByMonth.get(`${budgetId}:m${m.month}`) ?? '0',
      }));

    // Q1 of the earliest year has nothing before it; a quarter the calendar has not reached has
    // not started. Both are said in words by `compare`, not left blank — a blank reads equally as
    // "still loading" and as "zero".
    return {
      quarter: w.quarter,
      consumed: mine,
      months,
      utilizationPct: this.share(annualBudget, mine),
      elapsedDays: elapsed,
      days: w.days,
      complete: elapsed >= w.days,
      ...this.compare(mine, hasPrev ? prev : null, asOf < w.start),
      previousConsumed: prev,
    };
  }

  /**
   * A consumed amount as a share of the annual budget — the ONE place a share is computed.
   *
   * There is no percentage of nothing: a budget of zero has no share, and reporting one as `0` is
   * what every reader takes for untouched. The year's share and each quarter's share come from
   * here, so the four quarters and the year can never be computed by two different rules — which
   * is the defect this screen was repaired for once already.
   */
  private share(annualBudget: string, consumed: string): number | null {
    if (Money.compare(annualBudget, '0') === 0) return null;
    return Math.round((Number(consumed) / Number(annualBudget)) * 1000) / 10;
  }

  /**
   * The year figures for a row, from its four quarters.
   *
   * `yearConsumed` is the sum of the quarters rather than a separate total, so the two can never
   * disagree. `remaining` is left NEGATIVE where the budget is overspent: that is the fact, and
   * flooring it at zero is how a spreadsheet hides an overspend. A budget of zero consumed against
   * is OVERSPENT, and has no share and so no remaining share either.
   */
  private yearFigures(
    annualBudget: string,
    quarters: QuarterFigure[],
  ): Pick<
    BudgetQuarterRow,
    | 'yearConsumed'
    | 'remaining'
    | 'yearUtilizationPct'
    | 'remainingPct'
    | 'overspent'
  > {
    const yearConsumed = quarters.reduce(
      (s, q) => Money.add(s, q.consumed),
      '0',
    );
    const remaining = Money.subtract(annualBudget, yearConsumed);
    const yearUtilizationPct = this.share(annualBudget, yearConsumed);
    return {
      yearConsumed,
      remaining,
      yearUtilizationPct,
      remainingPct:
        yearUtilizationPct === null
          ? null
          : Math.round((100 - yearUtilizationPct) * 10) / 10,
      // Decided on the amounts, not on the rounded percentage: 100.04% rounds to 100.0, and a row
      // that has overspent must not read as exactly spent. Covers the zero budget in the same
      // comparison — anything consumed against nothing is more than nothing.
      overspent: Money.compare(yearConsumed, annualBudget) > 0,
    };
  }

  /** Departments carry the same shape as the lines beneath them, summed. */
  private rollUp(
    rows: BudgetQuarterRow[],
    windows: ReturnType<typeof quartersOf>,
  ): BudgetQuarterDepartment[] {
    const byDept = new Map<string, BudgetQuarterRow[]>();
    for (const r of rows)
      byDept.set(r.departmentId, [...(byDept.get(r.departmentId) ?? []), r]);

    return (
      [...byDept.entries()]
        .map(([departmentId, budgets]) => {
          // Its lines' ledger figures, summed — a department cannot state money its lines do not.
          const annualBudget = budgets.reduce(
            (s, b) => Money.add(s, b.amountTotal),
            '0',
          );
          const quarters = windows.map((w, i) => {
            const mine = budgets.reduce(
              (s, b) => Money.add(s, b.quarters[i].consumed),
              '0',
            );
            const prevAll = budgets.map((b) => b.quarters[i].previousConsumed);
            const hasPrev = prevAll.every((p) => p !== null);
            const prev = hasPrev
              ? prevAll.reduce<string>((s, p) => Money.add(s, p), '0')
              : null;
            const first = budgets[0].quarters[i];
            // A department's month is the sum of its lines' same month, so its three months sum to
            // its quarter for the same reason a line's do.
            const months: MonthFigure[] = first.months.map((m, mi) => ({
              month: m.month,
              consumed: budgets.reduce(
                (s, b) => Money.add(s, b.quarters[i].months[mi].consumed),
                '0',
              ),
            }));
            return {
              quarter: w.quarter,
              consumed: mine,
              months,
              // The SAME share rule the lines use, against the department's own annual total.
              utilizationPct: this.share(annualBudget, mine),
              elapsedDays: first.elapsedDays,
              days: w.days,
              complete: first.complete,
              // The SAME rule the budget rows use — see `compare`. A department inherits
              // "not started" from its lines, which all agree about the calendar.
              ...this.compare(mine, prev, first.noComparison === 'NOT_STARTED'),
              previousConsumed: prev,
            };
          });
          return {
            departmentId,
            departmentName: budgets[0].departmentName,
            amountTotal: annualBudget,
            quarters,
            ...this.yearFigures(annualBudget, quarters),
            budgets,
          };
        })
        // A department with no budget to measure against sorts to the top: it is the row most worth
        // looking at, and ordering it by a percentage it does not have would bury it.
        .sort((a, b) => {
          if (a.yearUtilizationPct === null && b.yearUtilizationPct === null)
            return 0;
          if (a.yearUtilizationPct === null) return -1;
          if (b.yearUtilizationPct === null) return 1;
          return b.yearUtilizationPct - a.yearUtilizationPct;
        })
    );
  }
}
