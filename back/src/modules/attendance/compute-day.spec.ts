import { describe, expect, it } from 'vitest';
import { AttendanceDayStatus, LeaveHalf } from '../../common/enums';
import { computeDay, type ComputeDayInput } from './compute-day';
import type { ResolvedShift } from './shift-resolution.service';

/**
 * Every rule in this slice is arithmetic on times, so it is proven here against fixtures rather
 * than through a database. The DB-backed spec only has to show that loading and persisting work.
 */

// The shift day is 2026-03-02 (a Monday) in a UTC+7 company: local midnight is 17:00 UTC on the 1st.
const DAY = '2026-03-02';
const DAY_START = new Date('2026-03-01T17:00:00Z');

/** An instant at `minutes` past the shift day's local midnight. */
const at = (minutes: number) => new Date(DAY_START.getTime() + minutes * 60_000);
/** `HH:MM` local on the shift day. */
const clock = (h: number, m = 0) => at(h * 60 + m);

const OFFICE: ResolvedShift = {
  shiftId: 's1',
  shiftCode: 'OFFICE',
  shiftName: 'Office',
  source: 'DEPARTMENT',
  isWorkingDay: true,
  expectedIn: '08:00',
  expectedOut: '17:00',
  expectedInMinute: 480,
  expectedOutMinute: 1020,
  expectedMinutes: 480,
  graceMinutes: 15,
  halfDayThresholdMinutes: 240,
  otMinMinutes: 30,
  otRoundMinutes: 30,
  breakStartMinute: 720,
  breakEndMinute: 780,
};

function run(overrides: Partial<ComputeDayInput> = {}) {
  return computeDay({
    shiftDate: DAY,
    shiftDayStart: DAY_START,
    shift: OFFICE,
    punches: [],
    isHoliday: false,
    attendanceRequired: true,
    ...overrides,
  });
}

const punchesAt = (...instants: Date[]) => instants.map((occurredAt) => ({ occurredAt }));

describe('computeDay — worked minutes and the break', () => {
  it('deducts the whole break on a full day', () => {
    const day = run({ punches: punchesAt(clock(8), clock(17)) });
    // 09:00 elapsed less the 1h lunch.
    expect(day.workedMinutes).toBe(480);
    expect(day.status).toBe(AttendanceDayStatus.PRESENT);
  });

  it('deducts nothing from a morning that ends before the break', () => {
    const day = run({ punches: punchesAt(clock(8), clock(12)) });
    expect(day.workedMinutes).toBe(240);
  });

  it('deducts only the overlapped part of the break', () => {
    const day = run({ punches: punchesAt(clock(8), clock(12, 30)) });
    // 4h30 elapsed, 30 minutes of lunch actually spanned.
    expect(day.workedMinutes).toBe(240);
  });

  it('deducts nothing for an afternoon that starts after the break', () => {
    const day = run({ punches: punchesAt(clock(13), clock(17)) });
    expect(day.workedMinutes).toBe(240);
  });

  it('deducts nothing when the shift has no break', () => {
    const noBreak = { ...OFFICE, breakStartMinute: undefined, breakEndMinute: undefined };
    const day = run({ shift: noBreak, punches: punchesAt(clock(8), clock(17)) });
    expect(day.workedMinutes).toBe(540);
  });
});

describe('computeDay — lateness', () => {
  it('is not late inside grace', () => {
    const day = run({ punches: punchesAt(clock(8, 10), clock(17)) });
    expect(day.lateMinutes).toBe(0);
    expect(day.lateOccurrences).toBe(0);
  });

  it('is not late exactly at the grace boundary', () => {
    const day = run({ punches: punchesAt(clock(8, 15), clock(17)) });
    expect(day.lateMinutes).toBe(0);
  });

  /** Grace decides WHETHER you are late, not by how much — 25 late is 25, not 25 minus grace. */
  it('measures lateness from the start, not from the end of grace', () => {
    const day = run({ punches: punchesAt(clock(8, 25), clock(17)) });
    expect(day.lateMinutes).toBe(25);
    expect(day.lateOccurrences).toBe(1);
  });

  it('leaves the status PRESENT, because lateness is a quantity not a category', () => {
    const day = run({ punches: punchesAt(clock(9), clock(16)) });
    expect(day.status).toBe(AttendanceDayStatus.PRESENT);
    expect(day.lateMinutes).toBe(60);
    expect(day.earlyLeaveMinutes).toBe(60);
  });

  it('is never negative for an early arrival', () => {
    const day = run({ punches: punchesAt(clock(7, 30), clock(17)) });
    expect(day.lateMinutes).toBe(0);
  });
});

describe('computeDay — early departure', () => {
  it('records leaving before the expected end', () => {
    const day = run({ punches: punchesAt(clock(8), clock(16, 30)) });
    expect(day.earlyLeaveMinutes).toBe(30);
  });

  it('is zero, not negative, for leaving after the end', () => {
    const day = run({ punches: punchesAt(clock(8), clock(18)) });
    expect(day.earlyLeaveMinutes).toBe(0);
  });
});

describe('computeDay — overtime', () => {
  it('discards overtime below the floor', () => {
    const day = run({ punches: punchesAt(clock(8), clock(17, 20)) });
    expect(day.otNormalMinutes).toBe(0);
  });

  it('rounds down to the configured block', () => {
    // 85 minutes past 17:00 -> 60, not 90.
    const day = run({ punches: punchesAt(clock(8), clock(18, 25)) });
    expect(day.otNormalMinutes).toBe(60);
  });

  it('counts exactly the floor', () => {
    const day = run({ punches: punchesAt(clock(8), clock(17, 30)) });
    expect(day.otNormalMinutes).toBe(30);
  });

  it('puts nothing in the holiday columns on a working day', () => {
    const day = run({ punches: punchesAt(clock(8), clock(19)) });
    expect(day.holidayWorkMinutes).toBe(0);
    expect(day.otHolidayMinutes).toBe(0);
  });
});

describe('computeDay — work on a holiday or day off', () => {
  it('records a company holiday worked as holiday work, not normal overtime', () => {
    const day = run({ isHoliday: true, punches: punchesAt(clock(8), clock(17)) });
    expect(day.status).toBe(AttendanceDayStatus.HOLIDAY);
    expect(day.holidayWorkMinutes).toBe(480);
    expect(day.otNormalMinutes).toBe(0);
  });

  it('records work on a shift day off as holiday work', () => {
    const dayOff = { ...OFFICE, isWorkingDay: false, expectedMinutes: 0 };
    const day = run({ shift: dayOff, punches: punchesAt(clock(8), clock(12)) });
    expect(day.status).toBe(AttendanceDayStatus.DAY_OFF);
    expect(day.holidayWorkMinutes).toBeGreaterThan(0);
  });

  it('splits extended holiday work across both holiday columns', () => {
    // 08:00-21:00 on a holiday: 13h elapsed less the 1h break = 720 worked. The first 480 are
    // normal holiday hours; the remaining 240 are overtime on a holiday, priced differently again.
    const day = run({ isHoliday: true, punches: punchesAt(clock(8), clock(21)) });
    expect(day.workedMinutes).toBe(720);
    expect(day.holidayWorkMinutes).toBe(480);
    expect(day.otHolidayMinutes).toBe(240);
  });

  it('is a holiday with no work when nobody punched', () => {
    const day = run({ isHoliday: true });
    expect(day.status).toBe(AttendanceDayStatus.HOLIDAY);
    expect(day.holidayWorkMinutes).toBe(0);
  });

  it('lets a holiday outrank a day off', () => {
    const dayOff = { ...OFFICE, isWorkingDay: false, expectedMinutes: 0 };
    const day = run({ shift: dayOff, isHoliday: true });
    expect(day.status).toBe(AttendanceDayStatus.HOLIDAY);
  });
});

/**
 * The case that fails outright if punches are grouped by their own calendar date instead of by the
 * shift's window — and the reason the window exists.
 */
describe('computeDay — night shift crossing midnight', () => {
  const NIGHT: ResolvedShift = {
    ...OFFICE,
    shiftCode: 'NIGHT',
    expectedIn: '22:00',
    expectedOut: '30:00', // 06:00 the following calendar day
    expectedInMinute: 1320,
    expectedOutMinute: 1800,
    expectedMinutes: 480,
    breakStartMinute: undefined,
    breakEndMinute: undefined,
  };

  it('treats punches on two calendar dates as one complete day', () => {
    // In at 22:05 on the shift date, out at 05:58 the next morning.
    const day = run({ shift: NIGHT, punches: punchesAt(clock(22, 5), clock(29, 58)) });
    expect(day.status).toBe(AttendanceDayStatus.PRESENT);
    expect(day.workedMinutes).toBe(473);
    expect(day.lateMinutes).toBe(0); // 5 minutes, inside 15 of grace
    expect(day.earlyLeaveMinutes).toBe(2);
  });

  it('measures night-shift lateness against the 22:00 start', () => {
    const day = run({ shift: NIGHT, punches: punchesAt(clock(22, 40), clock(30)) });
    expect(day.lateMinutes).toBe(40);
    expect(day.lateOccurrences).toBe(1);
  });

  it('counts overtime past a next-day end', () => {
    const day = run({ shift: NIGHT, punches: punchesAt(clock(22), clock(31)) });
    expect(day.otNormalMinutes).toBe(60);
  });
});

describe('computeDay — Saturday half day', () => {
  const SATURDAY = { ...OFFICE, expectedOut: '12:00', expectedOutMinute: 720, expectedMinutes: 240 };

  it('treats a 12:00 departure as on time, not early', () => {
    const day = run({ shift: SATURDAY, punches: punchesAt(clock(8), clock(12)) });
    expect(day.earlyLeaveMinutes).toBe(0);
    expect(day.otNormalMinutes).toBe(0);
    expect(day.status).toBe(AttendanceDayStatus.PRESENT);
  });

  it('counts work past the shorter end as overtime', () => {
    const day = run({ shift: SATURDAY, punches: punchesAt(clock(8), clock(13)) });
    expect(day.otNormalMinutes).toBe(60);
  });
});

describe('computeDay — approved leave', () => {
  it('a full leave day beats ABSENT, because the leave is why nobody came', () => {
    const day = run({ leave: LeaveHalf.FULL });
    expect(day.status).toBe(AttendanceDayStatus.LEAVE);
    expect(day.expectedMinutes).toBe(0);
    expect(day.lateMinutes).toBe(0);
  });

  it('leave on a holiday stays a holiday — leave on a day nobody works is not leave', () => {
    const day = run({ leave: LeaveHalf.FULL, isHoliday: true });
    expect(day.status).toBe(AttendanceDayStatus.HOLIDAY);
  });

  it('leave on a shift day off stays a day off', () => {
    const dayOff = { ...OFFICE, isWorkingDay: false, expectedMinutes: 0 };
    const day = run({ shift: dayOff, leave: LeaveHalf.FULL });
    expect(day.status).toBe(AttendanceDayStatus.DAY_OFF);
  });

  it('no leave leaves an empty working day ABSENT', () => {
    expect(run().status).toBe(AttendanceDayStatus.ABSENT);
  });

  /** The reason the half is stored rather than a 0.5 day count. */
  it('afternoon leave still expects the morning, so a late arrival is still late', () => {
    const day = run({ leave: LeaveHalf.PM, punches: punchesAt(clock(8, 40), clock(12)) });
    expect(day.status).toBe(AttendanceDayStatus.PRESENT);
    expect(day.lateMinutes).toBe(40);
    expect(day.expectedMinutes).toBe(240);
    // Leaving at noon is on time when the afternoon is taken.
    expect(day.earlyLeaveMinutes).toBe(0);
  });

  it('morning leave does not make a 13:00 arrival late', () => {
    const day = run({ leave: LeaveHalf.AM, punches: punchesAt(clock(13), clock(17)) });
    expect(day.status).toBe(AttendanceDayStatus.PRESENT);
    expect(day.lateMinutes).toBe(0);
    expect(day.earlyLeaveMinutes).toBe(0);
    expect(day.expectedMinutes).toBe(240);
  });

  it('morning leave still records a late afternoon arrival', () => {
    const day = run({ leave: LeaveHalf.AM, punches: punchesAt(clock(14), clock(17)) });
    expect(day.lateMinutes).toBe(60);
  });

  it('a half-day leave with no punches is ABSENT for the half that was expected', () => {
    const day = run({ leave: LeaveHalf.PM });
    expect(day.status).toBe(AttendanceDayStatus.ABSENT);
    expect(day.expectedMinutes).toBe(240);
  });

  it('overtime past a half day still counts', () => {
    // PM leave ends the working half at noon; staying to 14:00 is two hours past it.
    const day = run({ leave: LeaveHalf.PM, punches: punchesAt(clock(8), clock(14)) });
    expect(day.otNormalMinutes).toBe(120);
  });
});

describe('computeDay — status ladder and edges', () => {
  it('is NO_SHIFT when nothing resolves', () => {
    const day = run({ shift: null });
    expect(day.status).toBe(AttendanceDayStatus.NO_SHIFT);
    expect(day.shiftCode).toBeUndefined();
  });

  it('is ABSENT on a working day with no punches', () => {
    expect(run().status).toBe(AttendanceDayStatus.ABSENT);
  });

  it('is EXEMPT rather than ABSENT for a non-required employee', () => {
    const day = run({ attendanceRequired: false });
    expect(day.status).toBe(AttendanceDayStatus.EXEMPT);
  });

  it('is INCOMPLETE for a single punch, with no worked time', () => {
    const day = run({ punches: punchesAt(clock(8)) });
    expect(day.status).toBe(AttendanceDayStatus.INCOMPLETE);
    expect(day.workedMinutes).toBe(0);
    expect(day.firstInAt).toBeTruthy();
    expect(day.lastOutAt).toBeUndefined();
  });

  it('is INCOMPLETE when every punch shares an instant', () => {
    const day = run({ punches: punchesAt(clock(8), clock(8)) });
    expect(day.status).toBe(AttendanceDayStatus.INCOMPLETE);
  });

  it('excludes punches outside the collection window', () => {
    // 03:00 is more than three hours before an 08:00 start, so it belongs to no shift day here.
    const day = run({ punches: punchesAt(clock(3), clock(8), clock(17)) });
    expect(day.punchCount).toBe(2);
    expect(day.firstInAt?.getTime()).toBe(clock(8).getTime());
  });

  it('keeps the snapshot on every status that has a shift', () => {
    for (const day of [run(), run({ isHoliday: true }), run({ attendanceRequired: false })]) {
      expect(day.shiftCode).toBe('OFFICE');
      expect(day.expectedInMinute).toBe(480);
      expect(day.expectedOutMinute).toBe(1020);
    }
  });

  it('never returns a negative minute count', () => {
    const day = run({ punches: punchesAt(clock(12, 10), clock(12, 20)) });
    for (const value of [
      day.workedMinutes, day.lateMinutes, day.earlyLeaveMinutes,
      day.otNormalMinutes, day.holidayWorkMinutes, day.otHolidayMinutes,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
