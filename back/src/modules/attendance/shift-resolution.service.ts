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
    const day = date.slice(0, 10);
    const [resolved] = await this.resolveRange(employeeId, day, day);
    return resolved ?? null;
  }

  /**
   * Resolve every date from `fromDate` to `toDate` inclusive, in order, for one employee.
   *
   * Exists because recomputing a month one date at a time would issue a query per day per person:
   * the assignments, the department default, and each shift's seven weekday rows are the same for
   * the whole range, so they are loaded once and reused. A company-wide month goes from
   * O(employees x days) queries to O(employees).
   */
  async resolveRange(
    employeeId: string,
    fromDate: string,
    toDate: string,
  ): Promise<Array<ResolvedShift | null>> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const from = fromDate.slice(0, 10);
    const to = toDate.slice(0, 10);

    const employee = await em.findOne(
      Employee,
      { id: employeeId, company: companyId },
      { ...FILTER_OFF, populate: ['department'] },
    );
    if (!employee) throw new NotFoundException(`Employee ${employeeId} not found`);

    // Loaded once for the whole range rather than per date.
    const assignments = await em.find(
      EmployeeShift,
      { employee: employee.id },
      { ...FILTER_OFF, populate: ['workShift'] },
    );
    const department = await em.findOne(
      Department,
      { id: employee.department.id },
      { ...FILTER_OFF, populate: ['defaultWorkShift'] },
    );
    const fallback = (department?.defaultWorkShift as WorkShift | undefined) ?? undefined;

    // Weekday patterns, keyed by shift then ISO weekday. A month asks the same seven rows ~4 times
    // per shift, so they are fetched once per shift that actually appears in the range.
    const patterns = new Map<string, Map<number, WorkShiftDay>>();
    const loadPattern = async (shift: WorkShift): Promise<Map<number, WorkShiftDay>> => {
      let byWeekday = patterns.get(shift.id);
      if (!byWeekday) {
        const rows = await em.find(WorkShiftDay, { workShift: shift.id }, FILTER_OFF);
        byWeekday = new Map(rows.map((r) => [r.weekday, r]));
        patterns.set(shift.id, byWeekday);
      }
      return byWeekday;
    };

    const results: Array<ResolvedShift | null> = [];
    for (const day of eachDate(from, to)) {
      const covering = assignments.find(
        (a) => a.effectiveFrom <= day && (!a.effectiveTo || a.effectiveTo >= day),
      );
      const shift = covering?.workShift ?? fallback;
      if (!shift) {
        results.push(null);
        continue;
      }
      const source = covering ? 'EMPLOYEE' : 'DEPARTMENT';
      results.push(this.describeWith(shift, source, day, await loadPattern(shift)));
    }
    return results;
  }

  /**
   * Turn a shift plus that date's weekday pattern into the day's effective expectation. Takes the
   * pattern as a map rather than querying, so a range resolves without a query per date.
   */
  private describeWith(
    shift: WorkShift,
    source: 'EMPLOYEE' | 'DEPARTMENT',
    day: string,
    patternByWeekday: Map<number, WorkShiftDay>,
  ): ResolvedShift {
    const pattern = patternByWeekday.get(isoWeekday(day));

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
      // Derived from THIS day's effective hours, not from the shift's `standardMinutes`. A short
      // Saturday running 08:00-12:00 expects 240 minutes, not the 480 a full weekday does — and
      // reporting the shift-wide figure would make a half day of Saturday leave charge half of a
      // full day. `standardMinutes` remains the shift's nominal full day, which is what the
      // weekday rows default to when they carry no override.
      expectedMinutes: isWorkingDay
        ? expectedWorkingMinutes(expectedInMinute!, expectedOutMinute!, shift)
        : 0,
      graceMinutes: shift.graceMinutes,
      halfDayThresholdMinutes: shift.halfDayThresholdMinutes,
      otMinMinutes: shift.otMinMinutes,
      otRoundMinutes: shift.otRoundMinutes,
      breakStartMinute: shift.breakStartMinute,
      breakEndMinute: shift.breakEndMinute,
    };
  }
}

/** Every `YYYY-MM-DD` from `from` to `to` inclusive, in order. */
export function* eachDate(from: string, to: string): Generator<string> {
  const cursor = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  while (cursor <= last) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
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

/**
 * Paid minutes between two clock positions on one day, less whatever part of the shift's unpaid
 * break falls inside them. Used so a weekday with overridden hours reports its OWN expectation
 * rather than the shift's nominal full day.
 */
function expectedWorkingMinutes(
  fromMinute: number,
  toMinute: number,
  shift: { breakStartMinute?: number; breakEndMinute?: number },
): number {
  const span = Math.max(0, toMinute - fromMinute);
  if (shift.breakStartMinute === undefined || shift.breakEndMinute === undefined) return span;
  const overlap = Math.max(
    0,
    Math.min(toMinute, shift.breakEndMinute) - Math.max(fromMinute, shift.breakStartMinute),
  );
  return Math.max(0, span - overlap);
}
