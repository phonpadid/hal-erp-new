import { LeaveHalf } from '../../common/enums';
import type { ResolvedShift } from './shift-resolution.service';

/**
 * How much of a leave range each date actually charges.
 *
 * Pure, for the same reason `computeDay` is: the interesting cases — a public holiday inside the
 * range, a weekend, a short Saturday taken as a half day, a range that charges nothing at all —
 * are arithmetic, and arithmetic is worth proving as fixtures rather than through a database.
 *
 * The rule that makes this more than a date subtraction: leave charges WORKING days. A Monday-to-
 * Friday request with a public holiday on Thursday costs four days, not five, and a request that
 * lands entirely on days nobody works costs nothing — which is a request with no meaning, not a
 * free one.
 */

export interface LeaveDayInput {
  date: string;
  /** Null when no shift resolves for the employee on this date. */
  shift: ResolvedShift | null;
  isHoliday: boolean;
}

export interface LeaveDayContribution {
  date: string;
  half: LeaveHalf;
  /** 1, 0.5, or 0 — the fraction of a working day this date charges. */
  fraction: number;
  /** Minutes of that date's own expected time the leave covers. */
  minutes: number;
}

export interface LeaveCount {
  perDate: LeaveDayContribution[];
  /** What the quota is charged, as a decimal string — never a JS number on the wire. */
  totalDays: string;
}

/**
 * The half applying to a date within the range: the request's own halves at the ends, and full
 * days in between. A single-date request takes `fromHalf`.
 */
export function halfForDate(
  date: string,
  fromDate: string,
  toDate: string,
  fromHalf: LeaveHalf,
  toHalf: LeaveHalf,
): LeaveHalf {
  if (date === fromDate && date === toDate) {
    // One date, one half — the two ends describe the same day, so a FULL at either end means full.
    return fromHalf === LeaveHalf.FULL ? toHalf : fromHalf;
  }
  if (date === fromDate) return fromHalf;
  if (date === toDate) return toHalf;
  return LeaveHalf.FULL;
}

/**
 * What fraction of a day a half charges: a whole one, or half of THAT day.
 *
 * Extracted so the rule has one home. The period slice counts leave days from the daily projection
 * rather than by re-resolving shifts, and two spellings of "AM is half" would eventually disagree.
 */
export function fractionForHalf(half: LeaveHalf): number {
  return half === LeaveHalf.FULL ? 1 : 0.5;
}

/**
 * Count a leave range.
 *
 * A half day is half of THAT date's expected time, not half of a notional eight hours — so a half
 * day on a Saturday that runs 08:00-12:00 charges half of four hours. Using the resolved per-day
 * hours rather than a constant is what makes that fall out for free.
 */
export function countLeaveDays(
  days: LeaveDayInput[],
  fromHalf: LeaveHalf,
  toHalf: LeaveHalf,
): LeaveCount {
  if (days.length === 0) return { perDate: [], totalDays: '0.00' };
  const fromDate = days[0].date;
  const toDate = days[days.length - 1].date;

  const perDate: LeaveDayContribution[] = [];
  let total = 0;

  for (const day of days) {
    const half = halfForDate(day.date, fromDate, toDate, fromHalf, toHalf);

    // A holiday, a shift day off, or no shift at all: nothing was expected, so nothing is charged.
    // Leave taken on a day nobody works is not leave.
    const working = !!day.shift && day.shift.isWorkingDay && !day.isHoliday;
    if (!working) {
      perDate.push({ date: day.date, half, fraction: 0, minutes: 0 });
      continue;
    }

    const fraction = fractionForHalf(half);
    perDate.push({
      date: day.date,
      half,
      fraction,
      minutes: Math.round(day.shift!.expectedMinutes * fraction),
    });
    total += fraction;
  }

  return { perDate, totalDays: total.toFixed(2) };
}
