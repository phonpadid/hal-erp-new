import { describe, expect, it } from 'vitest';
import { AttendanceDayStatus, LeaveHalf } from '../../common/enums';
import { summarisePeriod, type PeriodDayInput } from './summarise-period';

/**
 * The whole fold is arithmetic over a set of days, so it is proven here against fixtures rather
 * than through a database — the same standing `computeDay` and `countLeaveDays` have. The
 * DB-backed spec only has to show that the right days and dates reach it.
 */

const day = (over: Partial<PeriodDayInput> & { shiftDate: string }): PeriodDayInput => ({
  status: AttendanceDayStatus.PRESENT,
  expectedMinutes: 480,
  workedMinutes: 480,
  lateMinutes: 0,
  lateOccurrences: 0,
  earlyLeaveMinutes: 0,
  otNormalMinutes: 0,
  holidayWorkMinutes: 0,
  otHolidayMinutes: 0,
  ...over,
});

const run = (
  days: PeriodDayInput[],
  certifiedDates: string[] = [],
  leave: Array<{ date: string; quotaId: string; half: LeaveHalf }> = [],
) => summarisePeriod({ days, certifiedDates: new Set(certifiedDates), leave });

describe('summarisePeriod — minutes and day counts', () => {
  it('sums expected and worked minutes across the period', () => {
    const s = run([
      day({ shiftDate: '2026-07-01' }),
      day({ shiftDate: '2026-07-02', workedMinutes: 300 }),
    ]);
    expect(s.expectedMinutes).toBe(960);
    expect(s.workedMinutes).toBe(780);
  });

  it('keeps late minutes and late occurrences apart', () => {
    // Thai discipline counts TIMES — three in a month is a warning letter — and pay deduction
    // counts MINUTES. Ten minutes on three days is one figure of 30 and another of 3.
    const s = run([
      day({ shiftDate: '2026-07-01', lateMinutes: 10, lateOccurrences: 1 }),
      day({ shiftDate: '2026-07-02', lateMinutes: 10, lateOccurrences: 1 }),
      day({ shiftDate: '2026-07-03', lateMinutes: 10, lateOccurrences: 1 }),
    ]);
    expect(s.lateMinutes).toBe(30);
    expect(s.lateOccurrences).toBe(3);
  });

  it('sums early departures', () => {
    const s = run([day({ shiftDate: '2026-07-01', earlyLeaveMinutes: 45 })]);
    expect(s.earlyLeaveMinutes).toBe(45);
  });

  it('counts each status into its own bucket', () => {
    const s = run([
      day({ shiftDate: '2026-07-01', status: AttendanceDayStatus.PRESENT }),
      day({ shiftDate: '2026-07-02', status: AttendanceDayStatus.ABSENT, workedMinutes: 0 }),
      day({ shiftDate: '2026-07-03', status: AttendanceDayStatus.LEAVE, workedMinutes: 0 }),
      day({ shiftDate: '2026-07-04', status: AttendanceDayStatus.HOLIDAY, expectedMinutes: 0, workedMinutes: 0 }),
      day({ shiftDate: '2026-07-05', status: AttendanceDayStatus.DAY_OFF, expectedMinutes: 0, workedMinutes: 0 }),
    ]);
    expect(s.daysPresent).toBe(1);
    expect(s.daysAbsent).toBe(1);
    expect(s.daysLeave).toBe(1);
    // Holiday and day off share a bucket: nobody is paid differently according to WHICH reason
    // they were not expected to work.
    expect(s.daysNotWorked).toBe(2);
  });

  it('counts an incomplete day as present', () => {
    // Somebody punched in and never out. Calling that absent would say they were not there, which
    // is false; the zero worked minutes already tell payroll the shortfall.
    const s = run([
      day({ shiftDate: '2026-07-01', status: AttendanceDayStatus.INCOMPLETE, workedMinutes: 0 }),
    ]);
    expect(s.daysPresent).toBe(1);
    expect(s.daysAbsent).toBe(0);
    expect(s.workedMinutes).toBe(0);
  });

  it('puts an exempt employee’s days in the not-worked bucket', () => {
    const s = run([
      day({ shiftDate: '2026-07-01', status: AttendanceDayStatus.EXEMPT, expectedMinutes: 0, workedMinutes: 0 }),
      day({ shiftDate: '2026-07-02', status: AttendanceDayStatus.NO_SHIFT, expectedMinutes: 0, workedMinutes: 0 }),
    ]);
    expect(s.daysNotWorked).toBe(2);
    expect(s.daysAbsent).toBe(0);
  });

  it('returns zeroes for a period with no days at all', () => {
    const s = run([]);
    expect(s.expectedMinutes).toBe(0);
    expect(s.daysPresent).toBe(0);
    expect(s.leaveDaysByQuota.size).toBe(0);
  });
});

describe('summarisePeriod — certified versus uncertified overtime', () => {
  const withOt = (date: string, normal: number, holidayWork = 0, otHoliday = 0) =>
    day({
      shiftDate: date,
      otNormalMinutes: normal,
      holidayWorkMinutes: holidayWork,
      otHolidayMinutes: otHoliday,
    });

  it('certifies only the dates an approved claim covers', () => {
    // A claim covering the 24th to the 27th, in a period that ends on the 25th. The claim's own
    // stored total is already aggregated over its whole range and could never be split; deciding
    // per DATE is what makes the boundary fall in the right place.
    const s = run(
      [withOt('2026-07-24', 60), withOt('2026-07-25', 90)],
      ['2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'],
    );
    expect(s.otNormalMinutes).toBe(150);
    expect(s.uncertifiedOtMinutes).toBe(0);
  });

  it('leaves unclaimed overtime out of the certified figures', () => {
    const s = run([withOt('2026-07-01', 60), withOt('2026-07-02', 30)], ['2026-07-01']);
    expect(s.otNormalMinutes).toBe(60);
    expect(s.uncertifiedOtMinutes).toBe(30);
  });

  it('keeps the three certified kinds separate', () => {
    const s = run([withOt('2026-07-01', 60, 480, 120)], ['2026-07-01']);
    expect(s.otNormalMinutes).toBe(60);
    expect(s.holidayWorkMinutes).toBe(480);
    expect(s.otHolidayMinutes).toBe(120);
  });

  it('does not split the uncertified total by kind', () => {
    // Deliberately one figure: split it and somebody multiplies it by a rate. Its only job is to
    // show that hours went unclaimed.
    const s = run([withOt('2026-07-01', 60, 480, 120)], []);
    expect(s.uncertifiedOtMinutes).toBe(660);
    expect(s.otNormalMinutes).toBe(0);
    expect(s.holidayWorkMinutes).toBe(0);
    expect(s.otHolidayMinutes).toBe(0);
  });

  it('reports nothing when no overtime was recorded at all', () => {
    const s = run([day({ shiftDate: '2026-07-01' })], ['2026-07-01']);
    expect(s.otNormalMinutes).toBe(0);
    expect(s.uncertifiedOtMinutes).toBe(0);
  });
});

describe('summarisePeriod — leave by type', () => {
  const SICK = 'quota-sick';
  const ANNUAL = 'quota-annual';

  it('produces one figure per leave type', () => {
    const s = run(
      [
        day({ shiftDate: '2026-07-01', status: AttendanceDayStatus.LEAVE }),
        day({ shiftDate: '2026-07-02', status: AttendanceDayStatus.LEAVE }),
        day({ shiftDate: '2026-07-03', status: AttendanceDayStatus.LEAVE }),
      ],
      [],
      [
        { date: '2026-07-01', quotaId: SICK, half: LeaveHalf.FULL },
        { date: '2026-07-02', quotaId: SICK, half: LeaveHalf.FULL },
        { date: '2026-07-03', quotaId: ANNUAL, half: LeaveHalf.FULL },
      ],
    );
    expect(s.leaveDaysByQuota.get(SICK)).toBe('2.00');
    expect(s.leaveDaysByQuota.get(ANNUAL)).toBe('1.00');
  });

  it('counts a half day as half of that day', () => {
    // A half day on a Saturday running 08:00-12:00 is half of THAT day, not half of eight hours.
    const s = run(
      [day({ shiftDate: '2026-07-04', expectedMinutes: 240 })],
      [],
      [{ date: '2026-07-04', quotaId: ANNUAL, half: LeaveHalf.AM }],
    );
    expect(s.leaveDaysByQuota.get(ANNUAL)).toBe('0.50');
  });

  it('charges nothing for leave on a day nobody works', () => {
    // Leave charges WORKING days, and `expected_minutes` is zero on a holiday or a shift day off.
    // Asking the projection rather than re-resolving the roster keeps the whole line reproducible.
    const s = run(
      [day({ shiftDate: '2026-07-04', status: AttendanceDayStatus.HOLIDAY, expectedMinutes: 0, workedMinutes: 0 })],
      [],
      [{ date: '2026-07-04', quotaId: SICK, half: LeaveHalf.FULL }],
    );
    expect(s.leaveDaysByQuota.size).toBe(0);
  });

  it('ignores leave for a date the period never had', () => {
    const s = run(
      [day({ shiftDate: '2026-07-01' })],
      [],
      [{ date: '2026-06-30', quotaId: SICK, half: LeaveHalf.FULL }],
    );
    expect(s.leaveDaysByQuota.size).toBe(0);
  });

  it('carries no paid or unpaid classification', () => {
    // The paid boundary is an annual cumulative rule — the first 30 days of sick leave in a YEAR —
    // so one month's figures cannot answer it, and pretending otherwise would be a lie payroll
    // would act on.
    const s = run(
      [day({ shiftDate: '2026-07-01', status: AttendanceDayStatus.LEAVE })],
      [],
      [{ date: '2026-07-01', quotaId: SICK, half: LeaveHalf.FULL }],
    );
    expect(Object.keys(s)).not.toContain('paidLeaveDays');
    expect(JSON.stringify([...s.leaveDaysByQuota])).not.toMatch(/paid|unpaid/i);
  });
});
