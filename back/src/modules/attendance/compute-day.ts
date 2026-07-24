import { AttendanceDayStatus, AttendanceDirection, LeaveHalf } from '../../common/enums';
import { MINUTES_PER_DAY } from './attendance.entities';
import type { ResolvedShift } from './shift-resolution.service';

/**
 * How far outside the shift a punch may fall and still belong to that shift day.
 *
 * Constants rather than configuration, deliberately. The windows of consecutive shift days must
 * not overlap, or a single punch would belong to two days: for a shift of length L, safety
 * requires `EARLY + LATE + L <= 24h`. At 3h + 6h that holds for any shift up to 15 hours, which
 * covers every real roster including a 12-hour rotation. Exposing these as a knob would let an
 * administrator widen them into overlap without any warning that day assignment had broken.
 *
 * The departure window is the wider of the two because that is the side real overtime uses: an
 * afternoon that runs to 21:00 on a public holiday is ordinary, whereas arriving six hours early
 * is not. It was 3h in the first draft and the holiday-overtime test caught it — a 13-hour holiday
 * shift had its evening check-out silently dropped, which turned genuine overtime into an
 * incomplete day. Beyond 6h past the end, a lone punch is far more likely a forgotten check-out
 * from the previous day than work, and belongs to no shift day.
 */
export const EARLY_ARRIVAL_WINDOW_MINUTES = 180;
export const LATE_DEPARTURE_WINDOW_MINUTES = 360;

/**
 * A punch reduced to what the computation needs: when it happened, and whether anything has since
 * said it did not.
 *
 * `id` and `correctsEventId` are optional so every caller that predates corrections keeps working
 * unchanged — with no ids, nothing can name anything, and the exclusion rules below are inert.
 */
export interface PunchInput {
  id?: string;
  occurredAt: Date;
  direction?: AttendanceDirection;
  /** The punch this one supersedes, when it is a corrective row. */
  correctsEventId?: string | null;
}

export interface ComputeDayInput {
  /** The shift day being computed, `YYYY-MM-DD` in the company's own timezone. */
  shiftDate: string;
  /** Local midnight of `shiftDate` as an instant — the origin all minute offsets are measured from. */
  shiftDayStart: Date;
  /** Null when no shift resolves for this employee on this date. */
  shift: ResolvedShift | null;
  /** Every punch that could plausibly belong to this day; filtering to the window happens here. */
  punches: PunchInput[];
  isHoliday: boolean;
  attendanceRequired: boolean;
  /**
   * The half of this date covered by APPROVED leave, if any. `FULL` excuses the day outright;
   * `AM` / `PM` do not change the status — they shrink what was expected so the other half is
   * still judged normally, which is the whole reason the half is stored rather than a day count.
   */
  leave?: LeaveHalf;
}

export interface ComputedDay {
  shiftCode?: string;
  expectedInMinute?: number;
  expectedOutMinute?: number;
  expectedMinutes?: number;
  firstInAt?: Date;
  lastOutAt?: Date;
  punchCount: number;
  workedMinutes: number;
  lateMinutes: number;
  lateOccurrences: number;
  earlyLeaveMinutes: number;
  otNormalMinutes: number;
  holidayWorkMinutes: number;
  otHolidayMinutes: number;
  status: AttendanceDayStatus;
}

const MS_PER_MINUTE = 60_000;

/**
 * Drop the punches that something later said did not happen.
 *
 * Two rules, both read-only — the ledger is append-only, so a wrong punch is never edited away.
 * It stays, and is simply not counted.
 *
 * 1. An event NAMED BY ANY OTHER event is superseded. Stated that way rather than by walking a
 *    chain, so A→B→C needs no ordering: A is named by B and B is named by C, so both fall out and
 *    only C stands. Walking would have to decide what "latest" means, and two corrections raised
 *    against the same punch would give it no answer.
 *
 * 2. A corrective event that RESTATES its target — same instant, same direction — is a void, and
 *    falls out alongside it. This is what a `REMOVE` correction inserts: "this punch should not
 *    exist" cannot be a delete, so it becomes a row that cancels its target while adding no time
 *    of its own. A `CHANGE` always moves the instant or the direction (the service rejects one
 *    that moves neither, since a change that changes nothing is not a request), so the two can
 *    never be confused.
 *
 * Both rules only ever remove punches from consideration; a day whose events name nothing computes
 * exactly as it did before corrections existed.
 */
function withoutSupersededPunches(punches: PunchInput[]): PunchInput[] {
  const named = new Set<string>();
  for (const p of punches) {
    if (p.correctsEventId) named.add(p.correctsEventId);
  }
  if (named.size === 0) return punches;

  const byId = new Map<string, PunchInput>();
  for (const p of punches) {
    if (p.id) byId.set(p.id, p);
  }

  const isVoid = (p: PunchInput): boolean => {
    if (!p.correctsEventId) return false;
    const target = byId.get(p.correctsEventId);
    // A target outside this day's loaded events cannot be judged, so the row is kept: counting a
    // punch that should not have counted is a visible error, dropping a real one is a silent one.
    if (!target) return false;
    return (
      target.occurredAt.getTime() === p.occurredAt.getTime() && target.direction === p.direction
    );
  };

  return punches.filter((p) => !(p.id && named.has(p.id)) && !isVoid(p));
}

/** Minutes from the shift day's local midnight — may be negative, or above 1440 for a next-day time. */
function minutesFromDayStart(instant: Date, shiftDayStart: Date): number {
  return Math.round((instant.getTime() - shiftDayStart.getTime()) / MS_PER_MINUTE);
}

/** Length of the intersection of two closed intervals, zero when they do not meet. */
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** Discard below the floor, then round DOWN to a block. Rounding up would pay for unworked time. */
function applyOvertimePolicy(rawMinutes: number, floor: number, block: number): number {
  if (rawMinutes < floor) return 0;
  const size = block > 0 ? block : 1;
  return Math.floor(rawMinutes / size) * size;
}

const EMPTY = {
  punchCount: 0,
  workedMinutes: 0,
  lateMinutes: 0,
  lateOccurrences: 0,
  earlyLeaveMinutes: 0,
  otNormalMinutes: 0,
  holidayWorkMinutes: 0,
  otHolidayMinutes: 0,
};

/**
 * Compare what was expected of a person on a shift day with what the ledger observed.
 *
 * Pure by design: no `EntityManager`, no I/O, no clock. Every rule in this slice is arithmetic on
 * times, and the cases that actually matter — a night shift crossing midnight, a half-day
 * Saturday, a break only partly spanned, overtime one minute below the floor — are all a fixture
 * and an expected object. The service around it only has to prove that loading and persisting
 * work, not that the arithmetic does.
 *
 * All offsets are minutes from the shift day's local midnight, which is what lets a night shift be
 * a single interval (22:00 = 1320, next-day 06:00 = 1800) instead of two calendar-date fragments.
 */
export function computeDay(input: ComputeDayInput): ComputedDay {
  const { shift, shiftDayStart, punches, isHoliday, attendanceRequired, leave } = input;

  // 1. No shift at all. A valid state, not an error: an exempt employee normally has none.
  if (!shift) {
    return { ...EMPTY, status: AttendanceDayStatus.NO_SHIFT };
  }

  const snapshot = {
    shiftCode: shift.shiftCode,
    expectedInMinute: shift.expectedInMinute ?? undefined,
    expectedOutMinute: shift.expectedOutMinute ?? undefined,
    expectedMinutes: shift.expectedMinutes,
  };

  // Non-working days still collect punches — someone may have come in — so the window is built
  // from the shift's own hours even when the pattern says the day is off.
  const nominalIn = shift.expectedInMinute ?? shift.expectedInMinute ?? 0;
  const nominalOut = shift.expectedOutMinute ?? nominalIn + MINUTES_PER_DAY;
  const windowStart = nominalIn - EARLY_ARRIVAL_WINDOW_MINUTES;
  const windowEnd = nominalOut + LATE_DEPARTURE_WINDOW_MINUTES;

  const inWindow = withoutSupersededPunches(punches)
    .map((p) => ({ at: p.occurredAt, minute: minutesFromDayStart(p.occurredAt, shiftDayStart) }))
    .filter((p) => p.minute >= windowStart && p.minute <= windowEnd)
    .sort((a, b) => a.minute - b.minute);

  // 2-4. The day was not one on which work was expected. Punches, if any, are still measured —
  // that is what makes holiday work visible — but nothing is late and nothing is absent.
  const dayIsOff = isHoliday || !shift.isWorkingDay;
  if (dayIsOff || !attendanceRequired) {
    const status = isHoliday
      ? AttendanceDayStatus.HOLIDAY
      : !shift.isWorkingDay
        ? AttendanceDayStatus.DAY_OFF
        : AttendanceDayStatus.EXEMPT;
    // NOTE: `LEAVE` slots in here, between EXEMPT and ABSENT, when the leave slice lands.
    return { ...snapshot, ...EMPTY, ...nonWorkingDay(inWindow, shift), status };
  }

  // 5. Approved leave covering the WHOLE day. Above ABSENT because the leave is the reason nobody
  // came; below HOLIDAY and DAY_OFF (handled above) because leave on a day nobody works is not
  // leave at all and charges nothing.
  if (leave === LeaveHalf.FULL) {
    return {
      ...snapshot,
      ...EMPTY,
      expectedMinutes: 0, // nothing was expected, so nothing is owed
      status: AttendanceDayStatus.LEAVE,
    };
  }

  // A half day does NOT change the status. It shrinks the expectation — the other half is still a
  // working half, and the employee can still be late for it.
  const expectedIn = halfAdjustedIn(shift, leave);
  const expectedOut = halfAdjustedOut(shift, leave);
  const expectedMinutes = leave ? Math.round(shift.expectedMinutes / 2) : shift.expectedMinutes;
  const adjusted = { ...snapshot, expectedInMinute: expectedIn, expectedOutMinute: expectedOut, expectedMinutes };

  // 6. A working day with nothing recorded.
  if (inWindow.length === 0) {
    return { ...adjusted, ...EMPTY, status: AttendanceDayStatus.ABSENT };
  }

  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];

  // 7. One punch (or several at the same instant) cannot bound a day.
  if (first.minute === last.minute) {
    return {
      ...adjusted,
      ...EMPTY,
      firstInAt: first.at,
      lastOutAt: undefined,
      punchCount: inWindow.length,
      status: AttendanceDayStatus.INCOMPLETE,
    };
  }

  // 8. A worked day. First/Last: the punches between are recorded but not interpreted, so a
  // mis-pressed button in the middle cannot corrupt the day. Judged against the HALF-ADJUSTED
  // expectation, so morning leave does not make a 13:00 arrival late.
  const worked = (last.minute - first.minute) - breakOverlap(first.minute, last.minute, shift);
  const lateBy = first.minute - expectedIn;
  // Grace decides WHETHER someone is late; it does not reduce by how much. Someone 25 minutes late
  // with 15 minutes of grace is 25 minutes late, not 10.
  const lateMinutes = lateBy > shift.graceMinutes ? lateBy : 0;
  const earlyLeaveMinutes = Math.max(0, expectedOut - last.minute);
  const rawOvertime = Math.max(0, last.minute - expectedOut);

  return {
    ...adjusted,
    firstInAt: first.at,
    lastOutAt: last.at,
    punchCount: inWindow.length,
    workedMinutes: Math.max(0, worked),
    lateMinutes: Math.max(0, lateMinutes),
    lateOccurrences: lateMinutes > 0 ? 1 : 0,
    earlyLeaveMinutes,
    otNormalMinutes: applyOvertimePolicy(rawOvertime, shift.otMinMinutes, shift.otRoundMinutes),
    holidayWorkMinutes: 0,
    otHolidayMinutes: 0,
    status: AttendanceDayStatus.PRESENT,
  };
}

/**
 * A holiday or day off on which someone may nonetheless have worked. Time inside the shift's
 * normal hours is `holidayWorkMinutes`; time beyond them is `otHolidayMinutes`. Thai law pays
 * these at different multiples again, which is why they cannot be one number.
 */
function nonWorkingDay(
  inWindow: Array<{ at: Date; minute: number }>,
  shift: ResolvedShift,
): Partial<ComputedDay> {
  if (inWindow.length < 2) {
    return inWindow.length === 1
      ? { firstInAt: inWindow[0].at, punchCount: 1 }
      : {};
  }
  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  if (first.minute === last.minute) return { firstInAt: first.at, punchCount: inWindow.length };

  const worked = (last.minute - first.minute) - breakOverlap(first.minute, last.minute, shift);
  // On a day with no scheduled hours, "normal hours" is the shift's standard length; anything
  // past it is overtime on a holiday.
  const normalCap = shift.expectedMinutes > 0 ? shift.expectedMinutes : MINUTES_PER_DAY;
  const normal = Math.min(Math.max(0, worked), normalCap);
  const beyond = Math.max(0, Math.max(0, worked) - normalCap);

  return {
    firstInAt: first.at,
    lastOutAt: last.at,
    punchCount: inWindow.length,
    workedMinutes: Math.max(0, worked),
    holidayWorkMinutes: normal,
    otHolidayMinutes: applyOvertimePolicy(beyond, shift.otMinMinutes, shift.otRoundMinutes),
  };
}

/**
 * Deduct only the part of the break the person was actually present for. A flat subtraction is
 * simpler and wrong at the edges that matter: someone who works 13:00-17:00 never sat through a
 * 12:00-13:00 lunch and must not be charged for it.
 */
function breakOverlap(fromMinute: number, toMinute: number, shift: ResolvedShift): number {
  if (shift.breakStartMinute === undefined || shift.breakEndMinute === undefined) return 0;
  return overlapMinutes(fromMinute, toMinute, shift.breakStartMinute, shift.breakEndMinute);
}

/**
 * Where the working half starts once leave is taken off one end. Morning leave pushes the expected
 * start to the afternoon — which is what stops a 13:00 arrival being recorded as five hours late.
 */
function halfAdjustedIn(shift: ResolvedShift, leave: LeaveHalf | undefined): number {
  const start = shift.expectedInMinute!;
  if (leave !== LeaveHalf.AM) return start;
  // The afternoon begins at the end of the break when there is one, else at the midpoint.
  return shift.breakEndMinute ?? Math.round((start + shift.expectedOutMinute!) / 2);
}

/** Where the working half ends. Afternoon leave pulls the expected end back to midday. */
function halfAdjustedOut(shift: ResolvedShift, leave: LeaveHalf | undefined): number {
  const end = shift.expectedOutMinute!;
  if (leave !== LeaveHalf.PM) return end;
  return shift.breakStartMinute ?? Math.round((shift.expectedInMinute! + end) / 2);
}
