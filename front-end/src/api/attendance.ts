import { api } from './client';
import type { Paginated } from './pagination';
import type {
  LeaveRequestCreateInput,
  PunchSelfInput,
  TimeCorrectionCreateInput,
} from '@erp/shared';

/**
 * Self-service attendance — what an employee sends and reads about their own attendance.
 *
 * Every route here resolves the employee from the caller's own account, so none of them accepts an
 * employee identifier. That absence is the security property, not an omission: there is no field
 * a bug could turn into a route to somebody else's attendance.
 */

/** A punch as the ledger stores it. Append-only server-side; nothing here edits one. */
export interface AttendanceEventRow {
  id: string;
  occurredAt: string;
  localDate: string;
  direction: 'IN' | 'OUT';
  source: string;
  geofenceStatus: 'INSIDE' | 'OUTSIDE' | 'UNKNOWN';
  distanceMeters?: string | null;
  remark?: string | null;
  workLocation?: { id: string; name: string } | null;
}

/**
 * One computed day. Late minutes and late OCCURRENCES are two figures because they answer two
 * questions — discipline counts times, pay counts minutes — and overtime stays split by kind
 * because the three are compensated at different rates and a total cannot be taken apart again.
 */
export interface AttendanceDayRow {
  id: string;
  shiftDate: string;
  shiftCode?: string | null;
  status: string;
  expectedMinutes?: number | null;
  workedMinutes: number;
  lateMinutes: number;
  lateOccurrences: number;
  earlyLeaveMinutes: number;
  otNormalMinutes: number;
  holidayWorkMinutes: number;
  otHolidayMinutes: number;
  punchCount: number;
  firstInAt?: string | null;
  lastOutAt?: string | null;
  /** When these numbers were produced — the projection's own staleness, exposed rather than assumed. */
  computedAt: string;
}

export interface MyDaysFilters {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}

/** What a candidate leave range would actually charge, before anything is submitted. */
export interface LeavePreview {
  totalDays: string;
  perDate: Array<{ date: string; half: string; fraction: number; minutes: number }>;
}

export const attendanceSelfApi = {
  checkIn: (dto: PunchSelfInput) => api.post('/attendance/check-in', dto).then((r) => r.data),
  checkOut: (dto: PunchSelfInput) => api.post('/attendance/check-out', dto).then((r) => r.data),
  myEvents: (date?: string) =>
    api
      .get<AttendanceEventRow[]>('/attendance/events/me', { params: date ? { date } : {} })
      .then((r) => r.data),
  /**
   * The caller's own days. Builds its params from the three named filters rather than spreading
   * whatever it was handed: the server already ignores an employee id here, and forwarding one
   * anyway would leave the only evidence of the attempt in a server log. The route's whole claim is
   * that it cannot be pointed at anybody else, and this is the client keeping that claim honest.
   */
  myDays: (page = 1, limit = 20, filters: MyDaysFilters = {}) =>
    api
      .get<Paginated<AttendanceDayRow>>('/attendance/days/me', {
        params: {
          page,
          limit,
          ...dropEmpty({
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            status: filters.status,
          }),
        },
      })
      .then((r) => r.data),
};

export const leaveSelfApi = {
  /**
   * What a range would charge the CALLER. Its own route rather than the parameterised one, so the
   * form never has to know its own employee id — and cannot be pointed at anyone else's days.
   */
  previewOwn: (params: { fromDate: string; toDate: string; fromHalf?: string; toHalf?: string }) =>
    api
      .get<LeavePreview>('/leave-requests/preview/me', {
        params: dropEmpty({
          fromDate: params.fromDate,
          toDate: params.toDate,
          fromHalf: params.fromHalf,
          toHalf: params.toHalf,
        }),
      })
      .then((r) => r.data),
  create: (dto: LeaveRequestCreateInput) => api.post('/leave-requests', dto).then((r) => r.data),
  submit: (documentId: string) =>
    api.post(`/leave-requests/${documentId}/submit`, {}).then((r) => r.data),
};

export const correctionSelfApi = {
  /**
   * The caller's OWN correctable punches. A separate route from the parameterised one because
   * `PermissionsGuard` requires every listed code, so "self or read" is not expressible on one
   * handler — the same split `attendance/events/me` and `attendance/days/me` already draw.
   */
  myCorrectable: (shiftDate: string) =>
    api
      .get<AttendanceEventRow[]>('/time-corrections/correctable/me', { params: { shiftDate } })
      .then((r) => r.data),
  create: (dto: TimeCorrectionCreateInput) => api.post('/time-corrections', dto).then((r) => r.data),
};

/** Drop blanks so an untouched filter does not become `?status=` and match nothing. */
function dropEmpty<T extends Record<string, unknown>>(source: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}
