import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AttendancePeriodStatus, PeriodAction } from '../../common/enums';
import { paginate, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { inTransaction, lockForUpdate } from '../../common/uow/unit-of-work';
import { Company } from '../multi-company/multi-company.entities';
import { Quota } from '../quota/quota.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import {
  AttendanceDay,
  AttendanceEvent,
  AttendancePeriod,
  AttendancePeriodLeave,
  AttendancePeriodLine,
  AttendancePeriodLog,
} from './attendance.entities';
import { LeaveRequestService } from './leave-request.service';
import { OvertimeClaimService } from './overtime-claim.service';
import { eachDate } from './shift-resolution.service';
import { summarisePeriod, type PeriodDayInput, type PeriodLeaveInput } from './summarise-period';
import type {
  CreateAttendancePeriodDto,
  ListAttendancePeriodQueryDto,
  ReopenPeriodDto,
  UpdateAttendancePeriodDto,
} from './dto/attendance-period.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Declaring a period, and closing it.
 *
 * Closing is the only act in this module that produces a number nobody is allowed to move. Every
 * other figure is a projection that a later approval may change — right up to the moment payroll
 * pays against one, after which a retroactive correction would silently alter what somebody was
 * already paid. A closed period answers the question "what did July report?" with the same figures
 * however often it is asked.
 *
 * No money appears anywhere here. Minutes and days by kind go out and the rate is multiplied
 * downstream, which is what lets one schema serve a Thai company and a Lao one (invariant 7).
 */
@Injectable()
export class AttendancePeriodService {
  constructor(
    private readonly em: EntityManager,
    private readonly companyScope: CompanyScopeService,
    private readonly leave: LeaveRequestService,
    private readonly claims: OvertimeClaimService,
  ) {}

  /** Declare a period. Stored as `DRAFT`: declaring is not closing. */
  async declare(dto: CreateAttendancePeriodDto): Promise<AttendancePeriod> {
    const companyId = RequestContext.companyId()!;
    const periodStart = dto.periodStart.slice(0, 10);
    const periodEnd = dto.periodEnd.slice(0, 10);
    if (periodEnd < periodStart) {
      throw new BadRequestException('The period end must not precede its start');
    }

    const em = this.companyScope.forActiveCompany(companyId);
    return inTransaction(em, async (tem) => {
      // Every period write for this company serialises on the company row. Locking the existing
      // periods would lock nothing when there are none, which is exactly the case two concurrent
      // first declarations hit — the same read-then-write hazard every slice of this module has
      // met, met once more.
      await lockForUpdate(tem, Company, { id: companyId }, FILTER_OFF);
      await this.assertNoOverlap(tem, companyId, periodStart, periodEnd);

      const period = tem.create(AttendancePeriod, {
        company: tem.getReference(Company, companyId),
        code: dto.code,
        periodStart,
        periodEnd,
      });
      await tem.persistAndFlush(period);
      return period;
    });
  }

  /** Edit a period that has not been closed. A closed period changes only by being reopened. */
  async update(periodId: string, dto: UpdateAttendancePeriodDto): Promise<AttendancePeriod> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);

    return inTransaction(em, async (tem) => {
      await lockForUpdate(tem, Company, { id: companyId }, FILTER_OFF);
      const period = await this.findOrFail(tem, periodId);
      if (period.status === AttendancePeriodStatus.CLOSED) {
        throw new BadRequestException(
          `Period '${period.code}' is closed. Reopen it before changing its dates.`,
        );
      }
      const periodStart = (dto.periodStart ?? period.periodStart).slice(0, 10);
      const periodEnd = (dto.periodEnd ?? period.periodEnd).slice(0, 10);
      if (periodEnd < periodStart) {
        throw new BadRequestException('The period end must not precede its start');
      }
      await this.assertNoOverlap(tem, companyId, periodStart, periodEnd, period.id);

      period.code = dto.code ?? period.code;
      period.periodStart = periodStart;
      period.periodEnd = periodEnd;
      await tem.flush();
      return period;
    });
  }

  /**
   * Close a period: write one line per employee and freeze the range.
   *
   * One transaction for the whole thing — the status flip, the lines, their leave children and the
   * log row commit together or not at all. A half-closed period is not a state anyone should have
   * to reason about, and the gates elsewhere read the status to decide whether a date is frozen.
   */
  async close(periodId: string): Promise<AttendancePeriod> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    if (!userId) throw new BadRequestException('No authenticated user in context');
    const em = this.companyScope.forActiveCompany(companyId);

    return inTransaction(em, async (tem) => {
      // Two concurrent closes would both read DRAFT and both write a full set of lines.
      const period = await lockForUpdate(tem, AttendancePeriod, { id: periodId }, FILTER_OFF);
      if (!period) throw new NotFoundException(`Period ${periodId} not found`);
      if (period.company.id !== companyId) throw new NotFoundException(`Period ${periodId} not found`);
      if (period.status === AttendancePeriodStatus.CLOSED) {
        throw new BadRequestException(`Period '${period.code}' is already closed`);
      }

      // A re-close after a reopen replaces the previous figures rather than adding to them. The
      // leave children go with their lines through the cascade.
      const previous = await tem.find(AttendancePeriodLine, { period: period.id }, FILTER_OFF);
      if (previous.length) await tem.nativeDelete(AttendancePeriodLine, { period: period.id }, FILTER_OFF);

      const employees = await tem.find(
        Employee,
        { company: companyId },
        { ...FILTER_OFF, populate: ['department'] },
      );
      for (const employee of employees) {
        await this.writeLine(tem, companyId, period, employee);
      }

      period.status = AttendancePeriodStatus.CLOSED;
      tem.persist(
        tem.create(AttendancePeriodLog, {
          period,
          action: PeriodAction.CLOSE,
          actedBy: tem.getReference(AppUser, userId),
          actedAt: new Date(),
        }),
      );
      await tem.flush();
      return period;
    });
  }

  /** Reopen a closed period. A reason is required: this reaches into a period that may be paid. */
  async reopen(periodId: string, dto: ReopenPeriodDto): Promise<AttendancePeriod> {
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId();
    if (!userId) throw new BadRequestException('No authenticated user in context');
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('Reopening a closed period requires a reason');

    const em = this.companyScope.forActiveCompany(companyId);
    return inTransaction(em, async (tem) => {
      const period = await lockForUpdate(tem, AttendancePeriod, { id: periodId }, FILTER_OFF);
      if (!period || period.company.id !== companyId) {
        throw new NotFoundException(`Period ${periodId} not found`);
      }
      if (period.status !== AttendancePeriodStatus.CLOSED) {
        throw new BadRequestException(`Period '${period.code}' is not closed`);
      }

      period.status = AttendancePeriodStatus.DRAFT;
      // The lines stay until the re-close replaces them: they are what the period currently
      // reports, and deleting them here would leave a reopened period reporting nothing at all.
      tem.persist(
        tem.create(AttendancePeriodLog, {
          period,
          action: PeriodAction.REOPEN,
          actedBy: tem.getReference(AppUser, userId),
          actedAt: new Date(),
          reason,
        }),
      );
      await tem.flush();
      return period;
    });
  }

  list(q: ListAttendancePeriodQueryDto = {}): Promise<Paginated<AttendancePeriod>> {
    const em = this.companyScope.forActiveCompany();
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    return paginate(em, AttendancePeriod, where, { orderBy: { periodStart: 'DESC' } }, q as PaginationQueryDto);
  }

  async lines(periodId: string): Promise<AttendancePeriodLine[]> {
    const em = this.companyScope.forActiveCompany();
    await this.findOrFail(em, periodId);
    return em.find(
      AttendancePeriodLine,
      { period: periodId },
      { populate: ['employee'], orderBy: { employee: { empCode: 'ASC' } } },
    );
  }

  async leaveOf(lineId: string): Promise<AttendancePeriodLeave[]> {
    const em = this.companyScope.forActiveCompany();
    return em.find(AttendancePeriodLeave, { line: lineId }, { ...FILTER_OFF, populate: ['quota'] });
  }

  /**
   * What was done to a period, oldest first.
   *
   * The actor is projected to an id and a username. Returning the `AttendancePeriodLog` rows with
   * `actedBy` populated shipped the whole account — `passwordHash` is `hidden` and safe, `email` is
   * not — and an audit trail needs to say who acted, not where they receive mail. The client has
   * always typed it this way and rendered only the username; the server was the one party
   * disagreeing with the contract.
   */
  async log(periodId: string): Promise<
    Array<{
      id: string;
      action: PeriodAction;
      actedAt: Date;
      reason?: string;
      actedBy: { id: string; username: string };
    }>
  > {
    const em = this.companyScope.forActiveCompany();
    await this.findOrFail(em, periodId);
    const rows = await em.find(
      AttendancePeriodLog,
      { period: periodId },
      { ...FILTER_OFF, populate: ['actedBy'], orderBy: { actedAt: 'ASC' } },
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actedAt: r.actedAt,
      reason: r.reason,
      actedBy: { id: r.actedBy.id, username: r.actedBy.username },
    }));
  }

  /**
   * How much of a period's range has actually been computed.
   *
   * Two figures, and they must stay two. `missing` is an employee-day the projection never produced
   * — work not yet done. `stale` is one whose row was computed BEFORE the last punch belonging to
   * it — work overtaken by a later observation. A single total would hide which of the two a given
   * month has, and they call for different actions.
   *
   * The reason this exists: `close()` summarises whatever `attendance_day` holds, so a range nobody
   * computed produces a full set of lines reading zero, indistinguishable from a month in which
   * nobody worked. That is fine to allow and intolerable to hide.
   *
   * Derived on read from `computed_at` and the ledger, and stored nowhere — the same standing
   * `staleLeaveDays` took, and for the same reason: a stored counter would be a third number able
   * to disagree with the two it summarises.
   */
  async coverage(periodId: string): Promise<{
    periodId: string;
    expectedEmployeeDays: number;
    computedEmployeeDays: number;
    missingEmployeeDays: number;
    staleEmployeeDays: number;
  }> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const period = await this.findOrFail(em, periodId);

    const employees = await em.find(Employee, { company: companyId }, { ...FILTER_OFF, fields: ['id'] });
    const dates = [...eachDate(period.periodStart, period.periodEnd)];
    const expectedEmployeeDays = employees.length * dates.length;

    const days = await em.find(
      AttendanceDay,
      { company: companyId, shiftDate: { $gte: period.periodStart, $lte: period.periodEnd } },
      { ...FILTER_OFF, fields: ['employee', 'shiftDate', 'computedAt'] },
    );

    // The newest punch per employee-day, so "computed before its own last punch" can be asked. The
    // window is the shift day rather than the calendar day, so an event is attributed the way the
    // projection attributes it — by `local_date`, which is what the day was collected under.
    const events = await em.find(
      AttendanceEvent,
      { company: companyId, localDate: { $gte: period.periodStart, $lte: period.periodEnd } },
      { ...FILTER_OFF, fields: ['employee', 'localDate', 'createdAt'] },
    );
    const newestPunch = new Map<string, number>();
    for (const event of events) {
      const key = `${event.employee.id}|${event.localDate}`;
      const at = event.createdAt.getTime();
      if (at > (newestPunch.get(key) ?? 0)) newestPunch.set(key, at);
    }

    let staleEmployeeDays = 0;
    for (const day of days) {
      const punchedAt = newestPunch.get(`${day.employee.id}|${day.shiftDate}`);
      if (punchedAt !== undefined && day.computedAt.getTime() < punchedAt) staleEmployeeDays += 1;
    }

    return {
      periodId: period.id,
      expectedEmployeeDays,
      computedEmployeeDays: days.length,
      missingEmployeeDays: Math.max(0, expectedEmployeeDays - days.length),
      staleEmployeeDays,
    };
  }

  /**
   * Punches recorded for dates that are already closed.
   *
   * The ledger accepts them — a late device upload must not be lost — but a closed day is not
   * recomputed, so they change nothing until somebody reopens. This read is what stops that being
   * a silence: month-end has a list to look at.
   */
  async eventsInClosedPeriods(
    q: PaginationQueryDto = {},
  ): Promise<Paginated<AttendanceEvent>> {
    const companyId = RequestContext.companyId()!;
    const em = this.companyScope.forActiveCompany(companyId);
    const closed = await em.find(
      AttendancePeriod,
      { company: companyId, status: AttendancePeriodStatus.CLOSED },
      FILTER_OFF,
    );
    if (closed.length === 0) {
      return { items: [], total: 0, page: q.page ?? 1, limit: q.limit ?? 20 };
    }
    // Paged with its total, not capped at a fixed maximum. A truncated list that does not say it
    // truncated reads as a complete one, and a month big enough to hit the cap is exactly the month
    // somebody most needs to see all of.
    return paginate(
      em,
      AttendanceEvent,
      { $or: closed.map((p) => ({ localDate: { $gte: p.periodStart, $lte: p.periodEnd } })) },
      { populate: ['employee'], orderBy: { occurredAt: 'DESC' } },
      q,
    );
  }

  /** One employee's line, and its leave children. */
  private async writeLine(
    tem: EntityManager,
    companyId: string,
    period: AttendancePeriod,
    employee: Employee,
  ): Promise<void> {
    const days = await tem.find(
      AttendanceDay,
      {
        employee: employee.id,
        shiftDate: { $gte: period.periodStart, $lte: period.periodEnd },
      },
      { ...FILTER_OFF, orderBy: { shiftDate: 'ASC' } },
    );

    const certifiedDates = await this.claims.claimedDates(
      employee.id,
      period.periodStart,
      period.periodEnd,
    );
    const coverage = await this.leave.coverageFor(
      employee.id,
      period.periodStart,
      period.periodEnd,
      tem,
    );
    const leave: PeriodLeaveInput[] = [...coverage.values()].map((c) => ({
      date: c.date,
      quotaId: c.quotaId,
      half: c.half,
    }));

    const summary = summarisePeriod({
      days: days.map(toDayInput),
      certifiedDates,
      leave,
    });

    const line = tem.create(AttendancePeriodLine, {
      company: tem.getReference(Company, companyId),
      period,
      employee: tem.getReference(Employee, employee.id),
      // Stamped, not read live: a figure produced from a closed period must not change meaning
      // because somebody edited configuration afterwards.
      employmentType: employee.employmentType,
      attendanceAffectsPay: resolveAffectsPay(employee),
      expectedMinutes: summary.expectedMinutes,
      workedMinutes: summary.workedMinutes,
      daysPresent: summary.daysPresent,
      daysAbsent: summary.daysAbsent,
      daysLeave: summary.daysLeave,
      daysNotWorked: summary.daysNotWorked,
      lateMinutes: summary.lateMinutes,
      lateOccurrences: summary.lateOccurrences,
      earlyLeaveMinutes: summary.earlyLeaveMinutes,
      otNormalMinutes: summary.otNormalMinutes,
      holidayWorkMinutes: summary.holidayWorkMinutes,
      otHolidayMinutes: summary.otHolidayMinutes,
      uncertifiedOtMinutes: summary.uncertifiedOtMinutes,
    });
    tem.persist(line);

    for (const [quotaId, days_] of summary.leaveDaysByQuota) {
      tem.persist(
        tem.create(AttendancePeriodLeave, {
          line,
          quota: tem.getReference(Quota, quotaId),
          days: days_,
        }),
      );
    }
  }

  /**
   * No two periods of one company may overlap, or "is this date closed?" has more than one answer
   * and every gate in this slice depends on it having exactly one. Gaps are allowed: a company that
   * never declares August simply has no closed August.
   */
  private async assertNoOverlap(
    tem: EntityManager,
    companyId: string,
    periodStart: string,
    periodEnd: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await tem.findOne(
      AttendancePeriod,
      {
        company: companyId,
        periodStart: { $lte: periodEnd },
        periodEnd: { $gte: periodStart },
        ...(exceptId ? { id: { $ne: exceptId } } : {}),
      },
      FILTER_OFF,
    );
    if (clash) {
      throw new BadRequestException(
        `${periodStart} to ${periodEnd} overlaps period '${clash.code}' ` +
          `(${clash.periodStart} to ${clash.periodEnd}); a shift date must belong to at most one period`,
      );
    }
  }

  private async findOrFail(em: EntityManager, periodId: string): Promise<AttendancePeriod> {
    const period = await em.findOne(AttendancePeriod, { id: periodId });
    if (!period) throw new NotFoundException(`Period ${periodId} not found`);
    return period;
  }
}

/**
 * Whether attendance drives this person's pay: their own value when set, their department's
 * otherwise. Nullable on the employee is what makes "inherit" expressible at all.
 */
export function resolveAffectsPay(employee: Employee): boolean {
  return employee.attendanceAffectsPay ?? employee.department.attendanceAffectsPay ?? true;
}

function toDayInput(day: AttendanceDay): PeriodDayInput {
  return {
    shiftDate: day.shiftDate,
    status: day.status,
    expectedMinutes: day.expectedMinutes ?? 0,
    workedMinutes: day.workedMinutes,
    lateMinutes: day.lateMinutes,
    lateOccurrences: day.lateOccurrences,
    earlyLeaveMinutes: day.earlyLeaveMinutes,
    otNormalMinutes: day.otNormalMinutes,
    holidayWorkMinutes: day.holidayWorkMinutes,
    otHolidayMinutes: day.otHolidayMinutes,
  };
}
