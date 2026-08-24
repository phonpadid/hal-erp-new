import { BudgetTxnType } from '../../common/enums';

/** A quarter of a fiscal year, 1–4. */
export type QuarterIndex = 1 | 2 | 3 | 4;

/** The window a quarter covers, as company-local `YYYY-MM-DD` dates, both ends inclusive. */
export interface QuarterWindow {
  quarter: QuarterIndex;
  start: string;
  end: string;
  /** Days in the quarter, both ends inclusive. */
  days: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → a UTC instant at midnight. Dates here are company-local days, never instants. */
const parse = (day: string): Date => new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
const format = (d: Date): string => d.toISOString().slice(0, 10);

const addMonths = (d: Date, months: number): Date => {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  // Clamp: a year starting on the 31st has quarters that start on shorter months.
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
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

/** The quarter a company-local day falls in, or undefined when it is outside the fiscal year. */
export function quarterOf(startDate: string, day: string): QuarterIndex | undefined {
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
  const reserveQuarter = new Map<string, QuarterIndex | undefined>();
  for (const t of txns) {
    if (t.txnType !== BudgetTxnType.RESERVE) continue;
    reserveQuarter.set(`${t.documentId}:${t.budgetId}`, quarterOf(startDate, t.txnDate));
  }
  const out = new Map<AttributableTxn, QuarterIndex | undefined>();
  for (const t of txns) {
    if (t.txnType === BudgetTxnType.RELEASE) {
      const key = `${t.documentId}:${t.budgetId}`;
      out.set(t, reserveQuarter.has(key) ? reserveQuarter.get(key) : quarterOf(startDate, t.txnDate));
      continue;
    }
    out.set(t, quarterOf(startDate, t.txnDate));
  }
  return out;
}
