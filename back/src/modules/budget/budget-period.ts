import { BudgetTxnType } from '../../common/enums';

/** A quarter of a fiscal year, 1–4. */
export type QuarterIndex = 1 | 2 | 3 | 4;

/** A month of a fiscal year, 1–12. Its POSITION in the year, never a calendar month. */
export type MonthIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** The window a quarter covers, as company-local `YYYY-MM-DD` dates, both ends inclusive. */
export interface QuarterWindow {
  quarter: QuarterIndex;
  start: string;
  end: string;
  /** Days in the quarter, both ends inclusive. */
  days: number;
}

/** The window a fiscal month covers, on the same terms as a quarter's. */
export interface MonthWindow {
  month: MonthIndex;
  /** The quarter this month falls in — `1..3` in Q1, `4..6` in Q2, and so on. */
  quarter: QuarterIndex;
  start: string;
  end: string;
  days: number;
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as MonthIndex[];

/** The quarter a fiscal month belongs to. Three months to a quarter, by construction. */
export const quarterOfMonth = (month: MonthIndex): QuarterIndex =>
  Math.ceil(month / 3) as QuarterIndex;

const DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → a UTC instant at midnight. Dates here are company-local days, never instants. */
const parse = (day: string): Date =>
  new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
const format = (d: Date): string => d.toISOString().slice(0, 10);

const addMonths = (d: Date, months: number): Date => {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  // Clamp: a year starting on the 31st has quarters that start on shorter months.
  const last = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0),
  ).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
};

/**
 * The four quarters of a fiscal year, measured from the year's OWN start date.
 *
 * Not from January. A company whose fiscal year starts in April has a Q1 of April–June, and
 * `fiscal_year.start_date` is the only thing that knows it — `year` is a label. This system is
 * multi-company by construction, so a calendar assumption here would be wrong quietly, for one
 * company, in a figure nobody re-derives by hand.
 */
export function quartersOf(startDate: string): QuarterWindow[] {
  const start = parse(startDate);
  return ([1, 2, 3, 4] as QuarterIndex[]).map((quarter) => {
    const from = addMonths(start, (quarter - 1) * 3);
    const to = new Date(addMonths(start, quarter * 3).getTime() - DAY);
    return {
      quarter,
      start: format(from),
      end: format(to),
      days: Math.round((to.getTime() - from.getTime()) / DAY) + 1,
    };
  });
}

/**
 * The twelve months of a fiscal year, measured from the year's OWN start date.
 *
 * Built the same way `quartersOf` is, from the same `addMonths`, so month boundaries land ON
 * quarter boundaries: months 1–3 fill Q1 exactly, 4–6 fill Q2, and so on. That is what lets three
 * monthly figures sum to their quarter without anything reconciling them.
 */
export function monthsOf(startDate: string): MonthWindow[] {
  const start = parse(startDate);
  return MONTHS.map((month) => {
    const from = addMonths(start, month - 1);
    const to = new Date(addMonths(start, month).getTime() - DAY);
    return {
      month,
      quarter: quarterOfMonth(month),
      start: format(from),
      end: format(to),
      days: Math.round((to.getTime() - from.getTime()) / DAY) + 1,
    };
  });
}

/** The fiscal month a company-local day falls in, or undefined when it is outside the year. */
export function monthOf(
  startDate: string,
  day: string,
): MonthIndex | undefined {
  const d = parse(day);
  for (const m of monthsOf(startDate)) {
    if (d >= parse(m.start) && d <= parse(m.end)) return m.month;
  }
  return undefined;
}

/** The quarter a company-local day falls in, or undefined when it is outside the fiscal year. */
export function quarterOf(
  startDate: string,
  day: string,
): QuarterIndex | undefined {
  const d = parse(day);
  for (const q of quartersOf(startDate)) {
    if (d >= parse(q.start) && d <= parse(q.end)) return q.quarter;
  }
  return undefined;
}

/** How many days of a quarter have passed on a given company day, capped at its length. */
export function elapsedDays(window: QuarterWindow, asOf: string): number {
  const start = parse(window.start);
  const now = parse(asOf);
  if (now < start) return 0;
  const passed = Math.round((now.getTime() - start.getTime()) / DAY) + 1;
  return Math.min(passed, window.days);
}

/** One ledger row, reduced to what deciding its quarter needs. */
export interface AttributableTxn {
  documentId: string;
  budgetId: string;
  txnType: BudgetTxnType;
  txnDate: string;
  amount: string;
}

/**
 * Which quarter each ledger row belongs to.
 *
 * Every row goes by its own `txn_date` EXCEPT a `RELEASE`, which goes to the quarter of the
 * `RESERVE` it gives back. A release is money returning to a commitment made earlier, and a
 * quarter that reports 100 when it really committed 70 — with the 30 landing as a negative in a
 * quarter that committed nothing — is the wrong answer twice over.
 *
 * The reserve is reachable because there is exactly ONE per `(document, budget)`: the reservation
 * sums a document's lines per budget before writing. A release with no reserve to point at (which
 * the ledger should never hold) falls back to its own date rather than being dropped.
 *
 * The cost is that a quarter already reported moves when a release lands later. That was asked of
 * the budget department directly and accepted: the figures are for internal use.
 */
export function attributeQuarters(
  startDate: string,
  txns: AttributableTxn[],
): Map<AttributableTxn, QuarterIndex | undefined> {
  return attributeBy(txns, (day) => quarterOf(startDate, day));
}

/**
 * Which fiscal MONTH each ledger row belongs to — the same rule, one period finer.
 *
 * A `RELEASE` returns to the month of the `RESERVE` it gives back, exactly as it returns to that
 * reserve's quarter. Any other rule breaks the sum this exists to keep: a release attributed to its
 * own month while its reserve sits in another puts a negative in one month and leaves the other
 * overstated, and the three months of a quarter stop adding up to the quarter.
 *
 * It carries the quarter rule's accepted cost at month granularity: a month already reported moves
 * when a release lands later.
 */
export function attributeMonths(
  startDate: string,
  txns: AttributableTxn[],
): Map<AttributableTxn, MonthIndex | undefined> {
  return attributeBy(txns, (day) => monthOf(startDate, day));
}

/**
 * The shared attribution: every row by its own date, a `RELEASE` by its reserve's.
 *
 * The reserve is reachable because there is exactly ONE per `(document, budget)`: the reservation
 * sums a document's lines per budget before writing. A release with no reserve to point at (which
 * the ledger should never hold) falls back to its own date rather than being dropped.
 *
 * One function so the quarter and the month can never disagree about where a release went, which
 * is the only way three months can be trusted to sum to their quarter.
 */
function attributeBy<T>(
  txns: AttributableTxn[],
  periodOf: (day: string) => T | undefined,
): Map<AttributableTxn, T | undefined> {
  const reservePeriod = new Map<string, T | undefined>();
  for (const t of txns) {
    if (t.txnType !== BudgetTxnType.RESERVE) continue;
    reservePeriod.set(`${t.documentId}:${t.budgetId}`, periodOf(t.txnDate));
  }
  const out = new Map<AttributableTxn, T | undefined>();
  for (const t of txns) {
    if (t.txnType === BudgetTxnType.RELEASE) {
      const key = `${t.documentId}:${t.budgetId}`;
      out.set(
        t,
        reservePeriod.has(key) ? reservePeriod.get(key) : periodOf(t.txnDate),
      );
      continue;
    }
    out.set(t, periodOf(t.txnDate));
  }
  return out;
}
