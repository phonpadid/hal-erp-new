import { defineStore } from 'pinia';
import { attendancePeriodsApi, punchLedgerApi, teamAttendanceApi } from '../api/attendanceHr';
import type {
  AttendancePeriodLeaveRow,
  AttendancePeriodLineRow,
  AttendancePeriodLogRow,
  AttendancePeriodRow,
  PeriodCoverage,
  PunchFilters,
  StaleLeaveDay,
  TeamDayFilters,
} from '../api/attendanceHr';
import type { AttendanceDayRow, AttendanceEventRow } from '../api/attendance';
import { documentsApi } from '../api/documents';
import { messageOf } from '../utils/apiError';
import type { TimeCorrectionCreateInput } from '@erp/shared';

/**
 * HR-facing attendance — the half that is about other people.
 *
 * A sibling of `attendance`, not an extension of it. The self-service store holds nothing about
 * WHOSE attendance it is, because every endpoint behind it resolves the caller; putting an employee
 * filter and an on-behalf punch into that same store would take the property away and leave the
 * next reader unable to tell which half they were touching. Two stores keep the boundary a boundary
 * rather than a naming convention.
 */

type PeriodRow = AttendancePeriodRow;
type TeamDay = AttendanceDayRow & { employee: { id: string; fullName: string } };
type LedgerPunch = AttendanceEventRow & { employee: { id: string; fullName: string } };

interface AttendanceHrState {
  periods: PeriodRow[];
  periodTotal: number;
  periodPage: number;
  periodLimit: number;
  /** Coverage per period id, so a list can show it without a read per row on every render. */
  coverage: Record<string, PeriodCoverage>;
  lines: AttendancePeriodLineRow[];
  lineLeave: Record<string, AttendancePeriodLeaveRow[]>;
  log: AttendancePeriodLogRow[];
  closedEvents: AttendanceEventRow[];
  closedEventTotal: number;
  closedEventPage: number;
  closedEventLimit: number;

  teamDays: TeamDay[];
  teamTotal: number;
  teamPage: number;
  teamLimit: number;
  teamFilters: TeamDayFilters;
  staleLeave: StaleLeaveDay[];

  punches: LedgerPunch[];
  punchTotal: number;
  punchPage: number;
  punchLimit: number;
  punchFilters: PunchFilters;

  loading: boolean;
  working: boolean;
  error: string;
}

export const useAttendanceHrStore = defineStore('attendanceHr', {
  state: (): AttendanceHrState => ({
    periods: [],
    periodTotal: 0,
    periodPage: 1,
    periodLimit: 20,
    coverage: {},
    lines: [],
    lineLeave: {},
    log: [],
    closedEvents: [],
    closedEventTotal: 0,
    closedEventPage: 1,
    closedEventLimit: 20,

    teamDays: [],
    teamTotal: 0,
    teamPage: 1,
    teamLimit: 20,
    teamFilters: {},
    staleLeave: [],

    punches: [],
    punchTotal: 0,
    punchPage: 1,
    punchLimit: 20,
    punchFilters: {},

    loading: false,
    working: false,
    error: '',
  }),

  actions: {
    // --- periods -----------------------------------------------------------

    async loadPeriods(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await attendancePeriodsApi.list(page ?? this.periodPage, limit ?? this.periodLimit);
        this.periodTotal = res.total;
        this.periodPage = res.page;
        this.periodLimit = res.limit;
        this.periods = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /**
     * How much of a period was actually computed. Best-effort: a coverage figure that cannot be
     * read is a reason to say so at the moment of closing, not a reason to break the list.
     */
    async loadCoverage(periodId: string) {
      try {
        this.coverage = { ...this.coverage, [periodId]: await attendancePeriodsApi.coverage(periodId) };
      } catch {
        // Left absent rather than zeroed: absent means unknown, and zero would claim it is current.
      }
    },

    async loadPeriodDetail(periodId: string) {
      this.loading = true;
      this.error = '';
      try {
        const [lines, log] = await Promise.all([
          attendancePeriodsApi.lines(periodId),
          attendancePeriodsApi.log(periodId),
        ]);
        this.lines = lines;
        this.log = log;
        // Leave rows per line, because leave types are configuration and cannot be columns.
        const leaves = await Promise.all(lines.map((l) => attendancePeriodsApi.lineLeave(l.id)));
        this.lineLeave = Object.fromEntries(lines.map((l, i) => [l.id, leaves[i]]));
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadClosedEvents(page?: number, limit?: number) {
      try {
        const res = await attendancePeriodsApi.closedEvents(
          page ?? this.closedEventPage,
          limit ?? this.closedEventLimit,
        );
        this.closedEvents = res.items;
        this.closedEventTotal = res.total;
        this.closedEventPage = res.page;
        this.closedEventLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      }
    },

    async declarePeriod(dto: { code: string; periodStart: string; periodEnd: string }): Promise<boolean> {
      return this.run(async () => {
        await attendancePeriodsApi.declare(dto);
        await this.loadPeriods();
      });
    },

    async updatePeriod(
      periodId: string,
      dto: { code?: string; periodStart?: string; periodEnd?: string },
    ): Promise<boolean> {
      return this.run(async () => {
        await attendancePeriodsApi.update(periodId, dto);
        await this.loadPeriods();
      });
    },

    async closePeriod(periodId: string): Promise<boolean> {
      return this.run(async () => {
        await attendancePeriodsApi.close(periodId);
        await this.loadPeriods();
      });
    },

    async reopenPeriod(periodId: string, reason: string): Promise<boolean> {
      return this.run(async () => {
        await attendancePeriodsApi.reopen(periodId, reason);
        await this.loadPeriods();
      });
    },

    // --- team days ---------------------------------------------------------

    async loadTeamDays(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await teamAttendanceApi.days(
          page ?? this.teamPage,
          limit ?? this.teamLimit,
          this.teamFilters,
        );
        this.teamTotal = res.total;
        this.teamPage = res.page;
        this.teamLimit = res.limit;
        this.teamDays = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    setTeamFilters(filters: TeamDayFilters) {
      this.teamFilters = filters;
      return this.loadTeamDays(1);
    },

    async loadStaleLeave() {
      try {
        this.staleLeave = await teamAttendanceApi.staleLeaveDays();
      } catch {
        this.staleLeave = [];
      }
    },

    /**
     * Rebuild a range for everybody. A date inside a closed period is refused by the SERVER with a
     * message naming it, and that message is what reaches the user — the closed-period rule is not
     * reimplemented here, because a second copy is a copy that drifts.
     */
    async recomputeCompany(dateFrom: string, dateTo?: string): Promise<number | null> {
      this.working = true;
      this.error = '';
      try {
        const result = await teamAttendanceApi.recomputeCompany(dateFrom, dateTo);
        await this.loadTeamDays();
        return result.employeeDays;
      } catch (e) {
        this.error = messageOf(e);
        return null;
      } finally {
        this.working = false;
      }
    },

    async recomputeEmployee(employeeId: string, dateFrom: string, dateTo?: string): Promise<boolean> {
      return this.run(async () => {
        await teamAttendanceApi.recomputeEmployee(employeeId, dateFrom, dateTo);
        await this.loadTeamDays();
      });
    },

    // --- punch ledger ------------------------------------------------------

    async loadPunches(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await punchLedgerApi.list(
          page ?? this.punchPage,
          limit ?? this.punchLimit,
          this.punchFilters,
        );
        this.punchTotal = res.total;
        this.punchPage = res.page;
        this.punchLimit = res.limit;
        this.punches = res.items;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    setPunchFilters(filters: PunchFilters) {
      this.punchFilters = filters;
      return this.loadPunches(1);
    },

    async punchFor(dto: {
      employeeId: string;
      occurredAt: string;
      direction: 'IN' | 'OUT';
      remark?: string;
    }): Promise<boolean> {
      return this.run(async () => {
        await punchLedgerApi.punchFor(dto);
        await this.loadPunches();
      });
    },

    async bulkPunch(dto: {
      employeeIds: string[];
      occurredAt: string;
      direction: 'IN' | 'OUT';
      remark?: string;
    }): Promise<boolean> {
      return this.run(async () => {
        await punchLedgerApi.bulkPunch(dto);
        await this.loadPunches();
      });
    },

    /**
     * Raise a correction ABOUT somebody else.
     *
     * The document carries `relatedEmployeeId`; the correction detail carries no employee at all.
     * That is what makes filing on somebody's behalf visible to every approver, instead of a value
     * in a request body that nobody downstream ever sees.
     */
    async requestCorrectionFor(
      documentTypeId: string,
      employeeId: string,
      detail: Omit<TimeCorrectionCreateInput, 'documentId'>,
    ): Promise<boolean> {
      return this.run(async () => {
        const doc = await documentsApi.create({ documentTypeId, relatedEmployeeId: employeeId });
        await punchLedgerApi.createCorrection({ ...detail, documentId: doc.id });
        await documentsApi.submit(doc.id);
      });
    },

    /**
     * The write shape this codebase already uses: the STORE refreshes what it invalidated and
     * returns a boolean; the view decides whether to toast. Factored out the way `quotaAdmin` does.
     */
    async run(fn: () => Promise<void>): Promise<boolean> {
      this.working = true;
      this.error = '';
      try {
        await fn();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.working = false;
      }
    },
  },
});
