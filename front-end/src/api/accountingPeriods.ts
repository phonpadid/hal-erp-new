import { api } from './client';

/**
 * An accounting period.
 *
 * `status` is `OPEN | CLOSED` — there is no DRAFT, and no update endpoint, so a declared period is
 * not editable. `fiscalYear` is an id rather than an object: `AccountingPeriodService.list()` does
 * not populate it.
 */
export interface AccountingPeriodRow {
  id: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  status: 'OPEN' | 'CLOSED';
  fiscalYear: string;
}

/** A fiscal year a period may be declared into. Open years only — the server filters. */
export interface SelectableFiscalYear {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
}

/** One thing that was done to a period. A `DECLARE` carries the range it set as its reason. */
export interface PeriodLogEntry {
  id: string;
  action: 'DECLARE' | 'CLOSE' | 'REOPEN';
  actedAt: string;
  reason?: string | null;
  /** Projected by the server to an id and a username — never the whole account. */
  actedBy: { id: string; username: string };
}

export interface DeclarePeriodInput {
  fiscalYearId: string;
  code: string;
  periodStart: string;
  periodEnd: string;
}

export const accountingPeriodsApi = {
  /** Unpaginated and ordered by start date — a company declares twelve of these a year. */
  list: () => api.get<AccountingPeriodRow[]>('/accounting-periods').then((r) => r.data),
  declare: (dto: DeclarePeriodInput) =>
    api.post<AccountingPeriodRow>('/accounting-periods', dto).then((r) => r.data),
  /**
   * Refused — not warned — while an earlier period is open or the company owes a posting. The
   * server's message names the obstacle; callers show it as returned.
   */
  close: (id: string) =>
    api.post<AccountingPeriodRow>(`/accounting-periods/${id}/close`, {}).then((r) => r.data),
  reopen: (id: string, reason: string) =>
    api.post<AccountingPeriodRow>(`/accounting-periods/${id}/reopen`, { reason }).then((r) => r.data),
  /**
   * Read on the period-management code, not the organisation's fiscal-year code — declaring a
   * period should not require administering the company's years.
   */
  selectableFiscalYears: () =>
    api.get<SelectableFiscalYear[]>('/accounting-periods/fiscal-years').then((r) => r.data),
  log: (id: string) =>
    api.get<PeriodLogEntry[]>(`/accounting-periods/${id}/log`).then((r) => r.data),
};
