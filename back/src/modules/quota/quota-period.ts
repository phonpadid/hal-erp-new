/**
 * Quota reset-period math. A quota's `reset_cycle` determines how `quota_usage` rows are
 * bucketed so each period resets independently (design: periodization by stamping):
 *
 *   YEARLY    → one period per year  (periodIndex = 1)
 *   QUARTERLY → four periods         (periodIndex = 1..4)
 *   MONTHLY   → twelve periods       (periodIndex = 1..12)
 *   NONE      → a single open period (periodYear = 0, periodIndex = 0)
 *
 * Boundaries follow the calendar year (UTC), matching the rest of the quota code.
 */

export type ResetCycle = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'NONE';

export interface QuotaPeriod {
  periodYear: number;
  periodIndex: number;
}

/** The reset period a date falls into for the given cycle. */
export function periodForCycle(resetCycle: string, date: Date = new Date()): QuotaPeriod {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1..12
  switch (resetCycle) {
    case 'MONTHLY':
      return { periodYear: year, periodIndex: month };
    case 'QUARTERLY':
      return { periodYear: year, periodIndex: Math.ceil(month / 3) };
    case 'YEARLY':
      return { periodYear: year, periodIndex: 1 };
    case 'NONE':
    default:
      return { periodYear: 0, periodIndex: 0 };
  }
}

/**
 * The reset period for a cycle when only the year is known (e.g. a personal entitlement
 * year, or an explicit period query). For sub-annual cycles a date is needed to pick the
 * index, so callers default to the current period via {@link periodForCycle}; this returns
 * the YEARLY/NONE period or the current sub-annual period within `year`.
 */
export function periodForYear(resetCycle: string, year: number, date: Date = new Date()): QuotaPeriod {
  if (resetCycle === 'YEARLY') return { periodYear: year, periodIndex: 1 };
  if (resetCycle === 'NONE') return { periodYear: 0, periodIndex: 0 };
  // Sub-annual: keep the requested year but use the current month/quarter index.
  return { ...periodForCycle(resetCycle, date), periodYear: year };
}
