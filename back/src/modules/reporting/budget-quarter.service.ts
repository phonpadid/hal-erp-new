import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { BudgetTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { localDateIn } from '../../common/time/company-clock';
import { attributeQuarters, elapsedDays, quartersOf } from '../budget/budget-period';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { FiscalYear } from '../multi-company/multi-company.entities';
import type { AttributableTxn, QuarterIndex } from '../budget/budget-period';

const FILTER_OFF = { filters: { company: false } } as const;

/** Why a quarter cannot be compared with the one before it. */
export type NoComparison = 'STARTED' | 'STOPPED' | 'NO_EARLIER_QUARTER' | 'NOT_STARTED';

export interface QuarterFigure {
  quarter: QuarterIndex;
  /** `Σ RESERVE − Σ RELEASE`, the releases attributed to the quarter that committed them. */
  consumed: string;
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
  amountTotal: string;
  quarters: QuarterFigure[];
  /** Null when there is no budget to measure against — never 0, which reads as untouched. */
  yearUtilizationPct: number | null;
  overspent: boolean;
}

export interface BudgetQuarterDepartment {
  departmentId: string;
  departmentName: string;
  amountTotal: string;
  quarters: QuarterFigure[];
  yearUtilizationPct: number | null;
  overspent: boolean;
  budgets: BudgetQuarterRow[];
}

export interface BudgetQuarterReport {
  fiscalYearId: string;
  year: number;
  /** The company day the elapsed figures were measured on. */
  asOf: string;
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

  async byQuarter(fiscalYearId?: string, departmentId?: string): Promise<BudgetQuarterReport> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();

    const fy = await em.findOne(
      FiscalYear,
      fiscalYearId ? { id: fiscalYearId, company: companyId } : { company: companyId },
      { ...FILTER_OFF, populate: ['company'], orderBy: { year: 'DESC' } },
    );
    if (!fy) throw new NotFoundException('No fiscal year to report on in the active company');

    // The company's day, not the server's — the same reason `budget_txn.txn_date` exists. "How
    // much of this quarter has passed" is a question about the company's calendar.
    const asOf = localDateIn(new Date(), fy.company.timezone ?? 'UTC');
    const windows = quartersOf(fy.startDate);

    const where: Record<string, unknown> = { fiscalYear: fy.id };
    if (departmentId) where.department = departmentId;
    const budgets = await em.find(Budget, where, {
      ...FILTER_OFF,
      populate: ['department', 'node'],
      orderBy: { node: { code: 'ASC' } },
    });
    if (!budgets.length) {
      return { fiscalYearId: fy.id, year: fy.year, asOf, departments: [] };
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

    // consumed per (budget, quarter), and per (budget, quarter) restricted to the first N days —
    // the second is what an unfinished quarter is compared against.
    const consumed = new Map<string, string>();
    const consumedWithin = new Map<string, string>();
    const key = (budgetId: string, q: QuarterIndex) => `${budgetId}:${q}`;

    const openQuarter = windows.find((w) => asOf >= w.start && asOf <= w.end);
    const openElapsed = openQuarter ? elapsedDays(openQuarter, asOf) : 0;

    for (const t of attributable) {
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

      // Same-window figure: is this row inside the first `openElapsed` days of ITS quarter?
      if (openQuarter) {
        const w = windows[q - 1];
        const day = elapsedDays(w, t.txnDate);
        if (day > 0 && day <= openElapsed) {
          consumedWithin.set(k, Money.add(consumedWithin.get(k) ?? '0', signed));
        }
      }
    }

    const rows: BudgetQuarterRow[] = budgets.map((b) => {
      const quarters = windows.map((w) =>
        this.figureFor(b.id, w, windows, asOf, openQuarter?.quarter, openElapsed, consumed, consumedWithin),
      );
      const yearConsumed = quarters.reduce((s, q) => Money.add(s, q.consumed), '0');
      return {
        budgetId: b.id,
        code: b.node.code,
        budgetName: b.budgetName ?? b.node.name ?? b.node.code,
        departmentId: b.department.id,
        departmentName: b.department.name,
        amountTotal: b.amountTotal,
        quarters,
        ...this.yearFigures(b.amountTotal, yearConsumed),
      };
    });

    return {
      fiscalYearId: fy.id,
      year: fy.year,
      asOf,
      departments: this.rollUp(rows, windows),
    };
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
    if (notStarted) return { changeAmount: null, changePct: null, noComparison: 'NOT_STARTED' };
    if (previous === null) {
      return { changeAmount: null, changePct: null, noComparison: 'NO_EARLIER_QUARTER' };
    }
    const changeAmount = Money.subtract(mine, previous);
    const prevZero = Money.compare(previous, '0') === 0;
    const mineZero = Money.compare(mine, '0') === 0;
    if (prevZero && !mineZero) return { changeAmount, changePct: null, noComparison: 'STARTED' };
    if (mineZero) return { changeAmount, changePct: null, noComparison: 'STOPPED' };
    return {
      changeAmount,
      changePct: Math.round((Number(changeAmount) / Number(previous)) * 1000) / 10,
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
    w: { quarter: QuarterIndex; days: number; start: string; end: string },
    windows: ReturnType<typeof quartersOf>,
    asOf: string,
    openQuarter: QuarterIndex | undefined,
    openElapsed: number,
    consumed: Map<string, string>,
    consumedWithin: Map<string, string>,
  ): QuarterFigure {
    const k = (q: QuarterIndex) => `${budgetId}:${q}`;
    const mine = consumed.get(k(w.quarter)) ?? '0';
    const isOpen = openQuarter === w.quarter;
    const elapsed = asOf > w.end ? w.days : isOpen ? openElapsed : asOf < w.start ? 0 : w.days;

    const prevIndex = (w.quarter - 1) as QuarterIndex;
    const hasPrev = w.quarter > 1;
    // The previous quarter over the same window when this one is open; whole otherwise.
    const prev = !hasPrev
      ? null
      : isOpen
        ? (consumedWithin.get(k(prevIndex)) ?? '0')
        : (consumed.get(k(prevIndex)) ?? '0');

    // Q1 of the earliest year has nothing before it; a quarter the calendar has not reached has
    // not started. Both are said in words by `compare`, not left blank — a blank reads equally as
    // "still loading" and as "zero".
    return {
      quarter: w.quarter,
      consumed: mine,
      elapsedDays: elapsed,
      days: w.days,
      complete: elapsed >= w.days,
      ...this.compare(mine, hasPrev ? prev : null, asOf < w.start),
      previousConsumed: prev,
    };
  }

  /**
   * Year utilization for a row, following the rule the annual report now follows: there is no
   * percentage of nothing. A budget of zero consumed against is OVERSPENT, and reporting it as 0%
   * is what every reader takes for untouched.
   */
  private yearFigures(
    amountTotal: string,
    consumed: string,
  ): { yearUtilizationPct: number | null; overspent: boolean } {
    const noBudget = Money.compare(amountTotal, '0') === 0;
    if (noBudget) {
      return { yearUtilizationPct: null, overspent: Money.compare(consumed, '0') > 0 };
    }
    const pct = (Number(consumed) / Number(amountTotal)) * 100;
    return { yearUtilizationPct: Math.round(pct * 10) / 10, overspent: pct > 100 };
  }

  /** Departments carry the same shape as the lines beneath them, summed. */
  private rollUp(
    rows: BudgetQuarterRow[],
    windows: ReturnType<typeof quartersOf>,
  ): BudgetQuarterDepartment[] {
    const byDept = new Map<string, BudgetQuarterRow[]>();
    for (const r of rows) byDept.set(r.departmentId, [...(byDept.get(r.departmentId) ?? []), r]);

    return [...byDept.entries()]
      .map(([departmentId, budgets]) => {
        const amountTotal = budgets.reduce((s, b) => Money.add(s, b.amountTotal), '0');
        const quarters = windows.map((w, i) => {
          const mine = budgets.reduce((s, b) => Money.add(s, b.quarters[i].consumed), '0');
          const prevAll = budgets.map((b) => b.quarters[i].previousConsumed);
          const hasPrev = prevAll.every((p) => p !== null);
          const prev = hasPrev
            ? prevAll.reduce<string>((s, p) => Money.add(s, p as string), '0')
            : null;
          const first = budgets[0].quarters[i];
          return {
            quarter: w.quarter,
            consumed: mine,
            elapsedDays: first.elapsedDays,
            days: w.days,
            complete: first.complete,
            // The SAME rule the budget rows use — see `compare`. A department inherits
            // "not started" from its lines, which all agree about the calendar.
            ...this.compare(mine, prev, first.noComparison === 'NOT_STARTED'),
            previousConsumed: prev,
          };
        });
        const yearConsumed = quarters.reduce((s, q) => Money.add(s, q.consumed), '0');
        return {
          departmentId,
          departmentName: budgets[0].departmentName,
          amountTotal,
          quarters,
          ...this.yearFigures(amountTotal, yearConsumed),
          budgets,
        };
      })
      // A department with no budget to measure against sorts to the top: it is the row most worth
      // looking at, and ordering it by a percentage it does not have would bury it.
      .sort((a, b) => {
        if (a.yearUtilizationPct === null && b.yearUtilizationPct === null) return 0;
        if (a.yearUtilizationPct === null) return -1;
        if (b.yearUtilizationPct === null) return 1;
        return b.yearUtilizationPct - a.yearUtilizationPct;
      });
  }
}
