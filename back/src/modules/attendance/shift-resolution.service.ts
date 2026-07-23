import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { EmployeeShift, WorkShift, WorkShiftDay } from './attendance.entities';
import { minutesToTime } from './shift-time';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * What a shift resolves to for one employee on one date. Carries the weekday's *effective*
 * hours, already merged with any per-day override, so a caller can judge the day without
 * re-reading configuration — and so the future `attendance_day` can snapshot these four values
 * flat rather than joining back to a shift that may since have been edited.
 */
export interface ResolvedShift {
  shiftId: string;
  shiftCode: string;
  shiftName: string;
  /** Where the shift came from — useful to explain an unexpected expectation to an admin. */
  source: 'EMPLOYEE' | 'DEPARTMENT';
  isWorkingDay: boolean;
  /** Null on a non-working day: there is no expected time to compare against. */
  expectedIn: string | null;
  expectedOut: string | null;
  expectedInMinute: number | null;
  expectedOutMinute: number | null;
  expectedMinutes: number;
  graceMinutes: number;
  halfDayThresholdMinutes: number;
  otMinMinutes: number;
  otRoundMinutes: number;
  breakStartMinute?: number;
  breakEndMinute?: number;
}

/**
 * Resolves the shift expected of an employee on a date: their own dated assignment first, then
 * their department's default, then nothing.
 *
 * "Nothing" is a legitimate answer, not an error. An employee with `attendanceRequired` false
 * normally has no shift at all, and the daily slice must read that as "nothing expected today"
 * rather than throwing — fixing the meaning here stops the next slice inventing a sentinel shift.
 *
 * Resolution deliberately accepts INACTIVE shifts. Deactivation removes a shift from the pickers,
 * but an assignment made before it was deactivated still describes the hours that person was
 * actually judged against, and history has to keep resolving.
 */
@Injectable()
export class ShiftResolutionService {
  constructor(private readonly em: EntityManager) {}

  async resolve(employeeId: string, date: string): Promise<ResolvedShift | null> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const day = date.slice(0, 10);

    const employee = await em.findOne(
      Employee,
      { id: employeeId, company: companyId },
      { ...FILTER_OFF, populate: ['department'] },
    );
    if (!employee) throw new NotFoundException(`Employee ${employeeId} not found`);

    const shift = await this.resolveShift(em, employee, day);
    if (!shift) return null;

    return this.describe(em, shift.shift, shift.source, day);
  }

  private async resolveShift(
    em: EntityManager,
    employee: Employee,
    day: string,
  ): Promise<{ shift: WorkShift; source: 'EMPLOYEE' | 'DEPARTMENT' } | null> {
    const assignments = await em.find(
      EmployeeShift,
      { employee: employee.id },
      { ...FILTER_OFF, populate: ['workShift'] },
    );
    const covering = assignments.find(
      (a) => a.effectiveFrom <= day && (!a.effectiveTo || a.effectiveTo >= day),
    );
    if (covering) return { shift: covering.workShift, source: 'EMPLOYEE' };

    const department = await em.findOne(
      Department,
      { id: employee.department.id },
      { ...FILTER_OFF, populate: ['defaultWorkShift'] },
    );
    const fallback = department?.defaultWorkShift;
    return fallback ? { shift: fallback as WorkShift, source: 'DEPARTMENT' } : null;
  }

  private async describe(
    em: EntityManager,
    shift: WorkShift,
    source: 'EMPLOYEE' | 'DEPARTMENT',
    day: string,
  ): Promise<ResolvedShift> {
    const weekday = isoWeekday(day);
    const pattern = await em.findOne(WorkShiftDay, { workShift: shift.id, weekday }, FILTER_OFF);

    // No row for this weekday means the shift does not work it (see the spec: a missing weekday
    // is non-working). An existing row may still switch it off explicitly.
    const isWorkingDay = !!pattern && pattern.isWorking;
    const expectedInMinute = isWorkingDay ? pattern.startMinute ?? shift.startMinute : null;
    const expectedOutMinute = isWorkingDay ? pattern.endMinute ?? shift.endMinute : null;

    return {
      shiftId: shift.id,
      shiftCode: shift.code,
      shiftName: shift.name,
      source,
      isWorkingDay,
      expectedIn: expectedInMinute === null ? null : minutesToTime(expectedInMinute),
      expectedOut: expectedOutMinute === null ? null : minutesToTime(expectedOutMinute),
      expectedInMinute,
      expectedOutMinute,
      expectedMinutes: isWorkingDay ? shift.standardMinutes : 0,
      graceMinutes: shift.graceMinutes,
      halfDayThresholdMinutes: shift.halfDayThresholdMinutes,
      otMinMinutes: shift.otMinMinutes,
      otRoundMinutes: shift.otRoundMinutes,
      breakStartMinute: shift.breakStartMinute,
      breakEndMinute: shift.breakEndMinute,
    };
  }
}

/**
 * ISO weekday (1 = Monday ... 7 = Sunday) of a `YYYY-MM-DD` date.
 *
 * Parsed as UTC deliberately: the input is already a calendar date in the company's own zone, so
 * re-interpreting it in the server's local zone would shift it by a day for servers west of the
 * company. There is no instant here to convert — only a date to name.
 */
export function isoWeekday(date: string): number {
  const day = new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
