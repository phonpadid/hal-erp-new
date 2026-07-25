import { api } from './client';
import type { AttendanceDayRow, AttendanceEventRow } from './attendance';
import type { Paginated } from './pagination';
import type { TimeCorrectionCreateInput } from '@erp/shared';

/**
 * HR-facing attendance — the endpoints that are about OTHER people.
 *
 * A separate module from `attendance.ts` for the same reason there are two stores: everything in
 * the self-service module resolves the caller and cannot name an employee, and everything here
 * names one. Keeping them apart is what stops the next reader having to check which half they are
 * touching.
 */

export interface AttendancePeriodRow {
  id: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  status: 'DRAFT' | 'CLOSED';
}

/** One employee's totals for a closed period. Produced by closing; replaced by re-closing. */
export interface AttendancePeriodLineRow {
  id: string;
  employee: { id: string; empCode: string; fullName: string };
  employmentType: string;
  attendanceAffectsPay: boolean;
  expectedMinutes: number;
  workedMinutes: number;
  daysPresent: number;
  daysAbsent: number;
  daysLeave: number;
  daysNotWorked: number;
  lateMinutes: number;
  lateOccurrences: number;
  earlyLeaveMinutes: number;
  otNormalMinutes: number;
  holidayWorkMinutes: number;
  otHolidayMinutes: number;
  uncertifiedOtMinutes: number;
}

export interface AttendancePeriodLeaveRow {
  id: string;
  quota: { id: string; quotaType: string };
  days: string;
}

export interface AttendancePeriodLogRow {
  id: string;
  action: 'CLOSE' | 'REOPEN';
  actedBy: { id: string; username: string };
  actedAt: string;
  reason?: string | null;
}

/**
 * How much of a period's range has been computed.
 *
 * Two figures, never one. `missing` is work never done; `stale` is work overtaken by a later punch.
 * A single total would hide which of the two a month has, and they call for different actions.
 */
export interface PeriodCoverage {
  periodId: string;
  expectedEmployeeDays: number;
  computedEmployeeDays: number;
  missingEmployeeDays: number;
  staleEmployeeDays: number;
}

export interface StaleLeaveDay {
  employeeId: string;
  date: string;
  documentId: string;
  approvedAt: string;
}

// Type aliases, not interfaces: only an alias carries the implicit index signature `dropEmpty`
// needs to accept it as a `Record<string, unknown>`.
export type TeamDayFilters = {
  employeeId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
};

export type PunchFilters = {
  employeeId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export const attendancePeriodsApi = {
  list: (page = 1, limit = 20, status?: string) =>
    api
      .get<Paginated<AttendancePeriodRow>>('/attendance-periods', {
        params: { page, limit, ...dropEmpty({ status }) },
      })
      .then((r) => r.data),
  lines: (periodId: string) =>
    api.get<AttendancePeriodLineRow[]>(`/attendance-periods/${periodId}/lines`).then((r) => r.data),
  lineLeave: (lineId: string) =>
    api
      .get<AttendancePeriodLeaveRow[]>(`/attendance-periods/lines/${lineId}/leave`)
      .then((r) => r.data),
  log: (periodId: string) =>
    api.get<AttendancePeriodLogRow[]>(`/attendance-periods/${periodId}/log`).then((r) => r.data),
  /** Read before closing, so a month of zeros is a decision rather than an accident. */
  coverage: (periodId: string) =>
    api.get<PeriodCoverage>(`/attendance-periods/${periodId}/coverage`).then((r) => r.data),
  /** Paged, not capped — a truncated list that does not say so reads as a complete one. */
  closedEvents: (page = 1, limit = 20) =>
    api
      .get<Paginated<AttendanceEventRow>>('/attendance-periods/closed-events', {
        params: { page, limit },
      })
      .then((r) => r.data),
  declare: (dto: { code: string; periodStart: string; periodEnd: string }) =>
    api.post('/attendance-periods', dto).then((r) => r.data),
  update: (periodId: string, dto: { code?: string; periodStart?: string; periodEnd?: string }) =>
    api.put(`/attendance-periods/${periodId}`, dto).then((r) => r.data),
  close: (periodId: string) =>
    api.post(`/attendance-periods/${periodId}/close`, {}).then((r) => r.data),
  /** Its own code, and a reason: this reaches into a period that may already have been paid. */
  reopen: (periodId: string, reason: string) =>
    api.post(`/attendance-periods/${periodId}/reopen`, { reason }).then((r) => r.data),
};

export const teamAttendanceApi = {
  days: (page = 1, limit = 20, filters: TeamDayFilters = {}) =>
    api
      .get<Paginated<AttendanceDayRow & { employee: { id: string; fullName: string } }>>(
        '/attendance/days',
        { params: { page, limit, ...dropEmpty(filters) } },
      )
      .then((r) => r.data),
  recomputeEmployee: (employeeId: string, dateFrom: string, dateTo?: string) =>
    api
      .post('/attendance/days/recompute', { employeeId, dateFrom, ...dropEmpty({ dateTo }) })
      .then((r) => r.data),
  /**
   * A RANGE, company-wide. A period is a range, so the action that makes one current has to be —
   * firing one request per day and hoping none fails quietly in the middle is not a workflow.
   */
  recomputeCompany: (dateFrom: string, dateTo?: string) =>
    api
      .post<{ dateFrom: string; dateTo: string; employeeDays: number }>(
        '/attendance/days/recompute/company',
        { dateFrom, ...dropEmpty({ dateTo }) },
      )
      .then((r) => r.data),
  /** Approved leave whose days have not caught up — outstanding work, not an endpoint nobody calls. */
  staleLeaveDays: () =>
    api.get<StaleLeaveDay[]>('/leave-requests/stale-days').then((r) => r.data),
};

export const punchLedgerApi = {
  list: (page = 1, limit = 20, filters: PunchFilters = {}) =>
    api
      .get<Paginated<AttendanceEventRow & { employee: { id: string; fullName: string } }>>(
        '/attendance/events',
        { params: { page, limit, ...dropEmpty(filters) } },
      )
      .then((r) => r.data),
  punchFor: (dto: {
    employeeId: string;
    occurredAt: string;
    direction: 'IN' | 'OUT';
    remark?: string;
  }) => api.post('/attendance/events', dto).then((r) => r.data),
  /** One instant and direction for a whole crew — confirmed before it is sent. */
  bulkPunch: (dto: { employeeIds: string[]; occurredAt: string; direction: 'IN' | 'OUT'; remark?: string }) =>
    api.post('/attendance/events/bulk', dto).then((r) => r.data),
  /** Somebody else's correctable punches. The parameterised route, gated on `ATTEND_PUNCH_READ`. */
  correctable: (employeeId: string, shiftDate: string) =>
    api
      .get<AttendanceEventRow[]>('/time-corrections/correctable', {
        params: { employeeId, shiftDate },
      })
      .then((r) => r.data),
  /**
   * The correction detail. It carries no employee — whose attendance is corrected comes from the
   * document's `related_employee_id`, which is what makes filing on somebody's behalf visible to
   * every approver instead of being a value in a request body.
   */
  createCorrection: (dto: TimeCorrectionCreateInput) =>
    api.post('/time-corrections', dto).then((r) => r.data),
};

function dropEmpty<T extends Record<string, unknown>>(source: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}
