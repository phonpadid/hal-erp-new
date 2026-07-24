import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AttendanceDayStatus } from '../../common/enums';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { Company, HolidayCalendar } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { AttendanceDay, AttendanceEvent } from './attendance.entities';
import {
  computeDay,
  EARLY_ARRIVAL_WINDOW_MINUTES,
  LATE_DEPARTURE_WINDOW_MINUTES,
  type ComputedDay,
} from './compute-day';
import { eachDate, ShiftResolutionService, type ResolvedShift } from './shift-resolution.service';
import type { ListAttendanceDayQueryDto } from './dto/attendance-day.dto';

const FILTER_OFF = { filters: { company: false } } as const;
const MS_PER_MINUTE = 60_000;

/**
 * Builds and maintains the daily projection.
 *
 * The projection is derived, so this service is the ONLY writer: nothing else may set these
 * numbers, and recomputing must always be safe to repeat. Capture deliberately does not call it —
 * a punch endpoint should not carry the cost of a projection write, and a bug here must never be
 * able to reject a fact in order to protect an opinion.
 */
@Injectable()
export class AttendanceDayService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly resolution: ShiftResolutionService,
  ) {}

  /** Recompute one employee-day. Idempotent: the same ledger yields the same row. */
  async recomputeDay(employeeId: string, shiftDate: string): Promise<AttendanceDay> {
    const [row] = await this.recomputeRange(employeeId, shiftDate, shiftDate);
    return row;
  }

  /**
   * Recompute every date in a range for one employee.
   *
   * Inputs that are constant across the range — the employee, the company timezone, the holiday
   * set, and the resolved shifts — are loaded once. Each day then commits in its own transaction,
   * so a failure on one Tuesday does not roll back a month of correct rows for the same person.
   * Idempotency is what makes that safe: a partial run is simply re-run.
   */
  async recomputeRange(employeeId: string, from: string, to: string): Promise<AttendanceDay[]> {
    const companyId = RequestContext.companyId()!;
    const fromDate = from.slice(0, 10);
    const toDate = to.slice(0, 10);
    if (toDate < fromDate) {
      throw new BadRequestException('The range end must not precede its start');
    }

    const em = this.companyScope.forActiveCompany(companyId);
    const employee = await em.findOne(Employee, { id: employeeId });
    if (!employee) throw new BadRequestException(`Unknown employee '${employeeId}'`);

    const timezone = await this.timezoneOf(em, companyId);
    const holidays = await this.holidaySet(em, fromDate, toDate);
    const shifts = await this.resolution.resolveRange(employeeId, fromDate, toDate);

    const rows: AttendanceDay[] = [];
    let index = 0;
    for (const date of eachDate(fromDate, toDate)) {
      rows.push(
        await this.persistDay(em, {
          companyId,
          employee,
          date,
          timezone,
          shift: shifts[index] ?? null,
          isHoliday: holidays.has(date),
        }),
      );
      index += 1;
    }
    return rows;
  }

  /**
   * Recompute one date for every employee of the active company. Commits per employee-day for the
   * same reason a range does: one person's bad day must not discard everyone else's good ones.
   */
  async recomputeCompanyDate(date: string): Promise<number> {
    const companyId = RequestContext.companyId()!;
    const shiftDate = date.slice(0, 10);
    const em = this.companyScope.forActiveCompany(companyId);
    const employees = await em.find(Employee, {}, { fields: ['id'] });

    let written = 0;
    for (const employee of employees) {
      await this.recomputeRange(employee.id, shiftDate, shiftDate);
      written += 1;
    }
    return written;
  }

  /** Paged, company-scoped read of the projection. */
  list(q: ListAttendanceDayQueryDto = {}): Promise<Paginated<AttendanceDay>> {
    const em = this.companyScope.forActiveCompany();
    return paginate(em, AttendanceDay, this.whereFrom(q), { orderBy: { shiftDate: 'ASC' } }, q as PaginationQueryDto);
  }

  /** The caller's own days. Resolves the employee from the account, so it cannot reach anyone else. */
  async listOwn(q: ListAttendanceDayQueryDto = {}): Promise<Paginated<AttendanceDay>> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    if (!userId) throw new BadRequestException('No authenticated user in context');
    const em = this.companyScope.forActiveCompany(companyId);
    const employee = await em.findOne(Employee, { user: userId });
    if (!employee) {
      throw new BadRequestException('Your account is not linked to an employee in this company');
    }
    const where = { ...this.whereFrom(q), employee: employee.id };
    return paginate(em, AttendanceDay, where, { orderBy: { shiftDate: 'ASC' } }, q as PaginationQueryDto);
  }

  private whereFrom(q: ListAttendanceDayQueryDto): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    if (q.employeeId) where.employee = q.employeeId;
    if (q.status) where.status = q.status;
    if (q.dateFrom || q.dateTo) {
      where.shiftDate = {
        ...(q.dateFrom ? { $gte: q.dateFrom.slice(0, 10) } : {}),
        ...(q.dateTo ? { $lte: q.dateTo.slice(0, 10) } : {}),
      };
    }
    return where;
  }

  /**
   * Compute and store one day. The projection row is taken FOR UPDATE inside the transaction so
   * two concurrent recomputes of the same day cannot both insert (violating the unique key) or
   * interleave into a half-updated row — the same read-then-write hazard the two previous slices
   * hit, for the third time.
   */
  private async persistDay(
    em: EntityManager,
    input: {
      companyId: string;
      employee: Employee;
      date: string;
      timezone: string;
      shift: ResolvedShift | null;
      isHoliday: boolean;
    },
  ): Promise<AttendanceDay> {
    const { companyId, employee, date, timezone, shift, isHoliday } = input;
    const dayStart = localMidnightInstant(date, timezone);
    const punches = await this.punchesForWindow(em, employee.id, dayStart, shift);

    const computed = computeDay({
      shiftDate: date,
      shiftDayStart: dayStart,
      shift,
      punches,
      isHoliday,
      attendanceRequired: employee.attendanceRequired,
    });

    return inTransaction(em, async (tem) => {
      const existing = await lockForUpdate(
        tem,
        AttendanceDay,
        { company: companyId, employee: employee.id, shiftDate: date },
        FILTER_OFF,
      );
      const row = existing ?? tem.create(AttendanceDay, {
        company: tem.getReference(Company, companyId),
        employee: tem.getReference(Employee, employee.id),
        shiftDate: date,
        status: computed.status,
      });
      applyComputed(row, computed);
      row.computedAt = new Date();
      await tem.persistAndFlush(row);
      return row;
    });
  }

  /**
   * The punches that could belong to this shift day. Widened by the same allowances the
   * computation uses, so an early arrival and an overtime departure are both loaded; the
   * computation then does the exact filtering.
   */
  private async punchesForWindow(
    em: EntityManager,
    employeeId: string,
    dayStart: Date,
    shift: ResolvedShift | null,
  ): Promise<Array<{ occurredAt: Date }>> {
    const startMinute = (shift?.expectedInMinute ?? 0) - EARLY_ARRIVAL_WINDOW_MINUTES;
    const endMinute = (shift?.expectedOutMinute ?? 1440) + LATE_DEPARTURE_WINDOW_MINUTES;
    const from = new Date(dayStart.getTime() + startMinute * MS_PER_MINUTE);
    const to = new Date(dayStart.getTime() + endMinute * MS_PER_MINUTE);
    const events = await em.find(
      AttendanceEvent,
      { employee: employeeId, occurredAt: { $gte: from, $lte: to } },
      { ...FILTER_OFF, fields: ['occurredAt'], orderBy: { occurredAt: 'ASC' } },
    );
    return events.map((e) => ({ occurredAt: e.occurredAt }));
  }

  private async holidaySet(em: EntityManager, from: string, to: string): Promise<Set<string>> {
    const rows = await em.find(HolidayCalendar, { holidayDate: { $gte: from, $lte: to } });
    return new Set(rows.map((h) => h.holidayDate));
  }

  private async timezoneOf(em: EntityManager, companyId: string): Promise<string> {
    const company = await em.findOne(Company, { id: companyId }, FILTER_OFF);
    if (!company) throw new BadRequestException(`Unknown company '${companyId}'`);
    return company.timezone;
  }
}

function applyComputed(row: AttendanceDay, computed: ComputedDay): void {
  row.shiftCode = computed.shiftCode;
  row.expectedInMinute = computed.expectedInMinute;
  row.expectedOutMinute = computed.expectedOutMinute;
  row.expectedMinutes = computed.expectedMinutes;
  row.firstInAt = computed.firstInAt;
  row.lastOutAt = computed.lastOutAt;
  row.punchCount = computed.punchCount;
  row.workedMinutes = computed.workedMinutes;
  row.lateMinutes = computed.lateMinutes;
  row.lateOccurrences = computed.lateOccurrences;
  row.earlyLeaveMinutes = computed.earlyLeaveMinutes;
  row.otNormalMinutes = computed.otNormalMinutes;
  row.holidayWorkMinutes = computed.holidayWorkMinutes;
  row.otHolidayMinutes = computed.otHolidayMinutes;
  row.status = computed.status;
}

/**
 * The instant of local midnight starting `date` in `timezone` — the origin every minute offset in
 * the computation is measured from.
 *
 * Derived by asking what the zone's offset is at midday on that date, rather than assuming a fixed
 * one: midday is chosen because it is never inside a DST transition, so the offset read there is
 * the day's own.
 */
export function localMidnightInstant(date: string, timezone: string): Date {
  const day = date.slice(0, 10);
  const midday = new Date(`${day}T12:00:00Z`);
  const asUtc = new Date(midday.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asLocal = new Date(midday.toLocaleString('en-US', { timeZone: timezone }));
  const offsetMinutes = Math.round((asLocal.getTime() - asUtc.getTime()) / MS_PER_MINUTE);
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - offsetMinutes * MS_PER_MINUTE);
}

export { AttendanceDayStatus };
