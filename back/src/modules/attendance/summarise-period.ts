import { AttendanceDayStatus, LeaveHalf } from '../../common/enums';
import { fractionForHalf } from './count-leave-days';

/**
 * Folding a period's days into one line per employee.
 *
 * Pure, for the reason `computeDay` and `countLeaveDays` are pure: everything interesting here is
 * arithmetic over a set of days — a claim that straddles the period edge, overtime nobody
 * certified, a half day of leave — and arithmetic is worth proving as fixtures rather than through
 * a database.
 *
 * Everything it needs comes from `attendance_day` and from which dates approved documents cover.
 * That is deliberate: it means a closed period's figures are reproducible from the projection and
 * the approvals alone, which is the property that makes closing mean anything.
 */

/** One day of the projection, reduced to what the fold needs. */
export interface PeriodDayInput {
  shiftDate: string;
  status: AttendanceDayStatus;
  expectedMinutes: number;
  workedMinutes: number;
  lateMinutes: number;
  lateOccurrences: number;
  earlyLeaveMinutes: number;
  otNormalMinutes: number;
  holidayWorkMinutes: number;
  otHolidayMinutes: number;
}

/** A date covered by approved leave, and which type charged it. */
export interface PeriodLeaveInput {
  date: string;
  quotaId: string;
  half: LeaveHalf;
}

export interface SummarisePeriodInput {
  days: PeriodDayInput[];
  /**
   * The dates an APPROVED overtime claim covers. A set of dates rather than the claims themselves,
   * because a claim's stored minutes are already aggregated over its whole range and a range that
   * crosses the period edge could never be taken apart again.
   */
  certifiedDates: ReadonlySet<string>;
  leave: PeriodLeaveInput[];
}

export interface PeriodSummary {
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
  /** Days charged, per quota, as decimal strings — halves are real and a float is not. */
  leaveDaysByQuota: Map<string, string>;
}

const EMPTY: Omit<PeriodSummary, 'leaveDaysByQuota'> = {
  expectedMinutes: 0,
  workedMinutes: 0,
  daysPresent: 0,
  daysAbsent: 0,
  daysLeave: 0,
  daysNotWorked: 0,
  lateMinutes: 0,
  lateOccurrences: 0,
  earlyLeaveMinutes: 0,
  otNormalMinutes: 0,
  holidayWorkMinutes: 0,
  otHolidayMinutes: 0,
  uncertifiedOtMinutes: 0,
};

export function summarisePeriod(input: SummarisePeriodInput): PeriodSummary {
  const out = { ...EMPTY, leaveDaysByQuota: new Map<string, string>() };
  const expectedOn = new Map<string, number>();

  for (const day of input.days) {
    expectedOn.set(day.shiftDate, day.expectedMinutes);

    out.expectedMinutes += day.expectedMinutes;
    out.workedMinutes += day.workedMinutes;
    out.lateMinutes += day.lateMinutes;
    out.lateOccurrences += day.lateOccurrences;
    out.earlyLeaveMinutes += day.earlyLeaveMinutes;

    switch (day.status) {
      case AttendanceDayStatus.PRESENT:
      // An INCOMPLETE day is a day they turned up: someone punched in and never out. Counting it
      // as absent would say they were not there, which is false; its zero worked minutes already
      // tell payroll the shortfall without this count having to lie about attendance.
      case AttendanceDayStatus.INCOMPLETE:
        out.daysPresent += 1;
        break;
      case AttendanceDayStatus.ABSENT:
        out.daysAbsent += 1;
        break;
      case AttendanceDayStatus.LEAVE:
        out.daysLeave += 1;
        break;
      default:
        // HOLIDAY, DAY_OFF, EXEMPT, NO_SHIFT. One bucket, because nobody is paid differently
        // according to WHICH reason they were not expected to work.
        out.daysNotWorked += 1;
        break;
    }

    // Certified is decided per DATE, not per claim. A claim covering the 24th to the 27th in a
    // period that ends on the 25th contributes only the 24th and 25th, and the two halves of it
    // land in two different periods without either having to know about the other.
    const observed = day.otNormalMinutes + day.holidayWorkMinutes + day.otHolidayMinutes;
    if (input.certifiedDates.has(day.shiftDate)) {
      out.otNormalMinutes += day.otNormalMinutes;
      out.holidayWorkMinutes += day.holidayWorkMinutes;
      out.otHolidayMinutes += day.otHolidayMinutes;
    } else {
      // Deliberately not split by kind. Split it and somebody multiplies it by a rate; its only
      // job is to show that hours went unclaimed.
      out.uncertifiedOtMinutes += observed;
    }
  }

  // Leave charges WORKING days, and the day the projection reported is what says whether a date was
  // one — `expected_minutes` is zero on a holiday, a shift day off, and a day with no shift. Asking
  // the projection rather than re-resolving the roster is what keeps the whole line reproducible
  // from `attendance_day` alone.
  const perQuota = new Map<string, number>();
  for (const entry of input.leave) {
    if (!expectedOn.get(entry.date)) continue;
    perQuota.set(entry.quotaId, (perQuota.get(entry.quotaId) ?? 0) + fractionForHalf(entry.half));
  }
  for (const [quotaId, days] of perQuota) {
    if (days > 0) out.leaveDaysByQuota.set(quotaId, days.toFixed(2));
  }

  return out;
}
