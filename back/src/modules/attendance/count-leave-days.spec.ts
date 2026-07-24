import { describe, expect, it } from 'vitest';
import { LeaveHalf } from '../../common/enums';
import { countLeaveDays, halfForDate, type LeaveDayInput } from './count-leave-days';
import type { ResolvedShift } from './shift-resolution.service';

const WEEKDAY: ResolvedShift = {
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

/** The Saturday the user's company actually works: 08:00-12:00, four hours. */
const SHORT_SATURDAY: ResolvedShift = {
  ...WEEKDAY,
  expectedOut: '12:00',
  expectedOutMinute: 720,
  expectedMinutes: 240,
};

const DAY_OFF: ResolvedShift = { ...WEEKDAY, isWorkingDay: false, expectedMinutes: 0 };

const working = (date: string, shift = WEEKDAY): LeaveDayInput => ({ date, shift, isHoliday: false });
const holiday = (date: string): LeaveDayInput => ({ date, shift: WEEKDAY, isHoliday: true });
const dayOff = (date: string): LeaveDayInput => ({ date, shift: DAY_OFF, isHoliday: false });

describe('halfForDate', () => {
  it('applies the range ends and fills the middle', () => {
    const args = ['2026-03-10', '2026-03-12', LeaveHalf.PM, LeaveHalf.AM] as const;
    expect(halfForDate('2026-03-10', ...args)).toBe(LeaveHalf.PM);
    expect(halfForDate('2026-03-11', ...args)).toBe(LeaveHalf.FULL);
    expect(halfForDate('2026-03-12', ...args)).toBe(LeaveHalf.AM);
  });

  it('collapses a single-date request to one half', () => {
    expect(halfForDate('2026-03-10', '2026-03-10', '2026-03-10', LeaveHalf.AM, LeaveHalf.FULL)).toBe(LeaveHalf.AM);
    expect(halfForDate('2026-03-10', '2026-03-10', '2026-03-10', LeaveHalf.FULL, LeaveHalf.PM)).toBe(LeaveHalf.PM);
    expect(halfForDate('2026-03-10', '2026-03-10', '2026-03-10', LeaveHalf.FULL, LeaveHalf.FULL)).toBe(LeaveHalf.FULL);
  });
});

describe('countLeaveDays', () => {
  it('charges every working day of a plain range', () => {
    const days = ['2026-03-02', '2026-03-03', '2026-03-04'].map((d) => working(d));
    expect(countLeaveDays(days, LeaveHalf.FULL, LeaveHalf.FULL).totalDays).toBe('3.00');
  });

  /** The case that makes this more than date arithmetic. */
  it('does not charge a public holiday inside the range', () => {
    const days = [
      working('2026-03-02'), working('2026-03-03'), working('2026-03-04'),
      holiday('2026-03-05'), working('2026-03-06'),
    ];
    const result = countLeaveDays(days, LeaveHalf.FULL, LeaveHalf.FULL);
    expect(result.totalDays).toBe('4.00');
    expect(result.perDate.find((d) => d.date === '2026-03-05')?.fraction).toBe(0);
  });

  it('does not charge a weekend inside the range', () => {
    const days = [
      working('2026-03-06'), dayOff('2026-03-07'), dayOff('2026-03-08'), working('2026-03-09'),
    ];
    expect(countLeaveDays(days, LeaveHalf.FULL, LeaveHalf.FULL).totalDays).toBe('2.00');
  });

  it('charges half for a half-day end', () => {
    const days = [working('2026-03-10'), working('2026-03-11'), working('2026-03-12')];
    // PM on the first day, AM on the last: half + full + half.
    expect(countLeaveDays(days, LeaveHalf.PM, LeaveHalf.AM).totalDays).toBe('2.00');
  });

  it('charges a single half day as 0.5', () => {
    expect(countLeaveDays([working('2026-03-10')], LeaveHalf.AM, LeaveHalf.FULL).totalDays).toBe('0.50');
  });

  /** Half of THAT day, not half of a notional eight hours. */
  it('makes a half day on a short Saturday half of that Saturday', () => {
    const result = countLeaveDays([working('2026-03-07', SHORT_SATURDAY)], LeaveHalf.AM, LeaveHalf.FULL);
    expect(result.totalDays).toBe('0.50');
    // 240 expected minutes on that Saturday -> 120, not 240.
    expect(result.perDate[0].minutes).toBe(120);
  });

  it('reports full-weekday minutes for a full weekday', () => {
    const result = countLeaveDays([working('2026-03-02')], LeaveHalf.FULL, LeaveHalf.FULL);
    expect(result.perDate[0].minutes).toBe(480);
  });

  it('charges nothing when the range covers only non-working days', () => {
    const days = [dayOff('2026-03-07'), dayOff('2026-03-08')];
    expect(countLeaveDays(days, LeaveHalf.FULL, LeaveHalf.FULL).totalDays).toBe('0.00');
  });

  it('charges nothing when no shift resolves', () => {
    const days = [{ date: '2026-03-02', shift: null, isHoliday: false }];
    expect(countLeaveDays(days, LeaveHalf.FULL, LeaveHalf.FULL).totalDays).toBe('0.00');
  });

  it('does not let a half day on a holiday charge anything', () => {
    const result = countLeaveDays([holiday('2026-03-05')], LeaveHalf.AM, LeaveHalf.FULL);
    expect(result.totalDays).toBe('0.00');
  });

  it('returns a decimal string, never a number', () => {
    const result = countLeaveDays([working('2026-03-02')], LeaveHalf.FULL, LeaveHalf.FULL);
    expect(typeof result.totalDays).toBe('string');
    expect(result.totalDays).toBe('1.00');
  });

  it('handles an empty range', () => {
    expect(countLeaveDays([], LeaveHalf.FULL, LeaveHalf.FULL).totalDays).toBe('0.00');
  });
});
