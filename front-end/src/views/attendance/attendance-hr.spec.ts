import { afterEach, describe, expect, it } from 'vitest';
import { evaluateGuard } from '../../router';
import la from '../../i18n/locales/la';
import { mountView } from '../../test/mountView';
import { useAttendanceHrStore } from '../../stores/attendanceHr';
import AttendancePeriodDetailView from './AttendancePeriodDetailView.vue';
import AttendancePeriodsView from './AttendancePeriodsView.vue';
import PunchLedgerView from './PunchLedgerView.vue';
import TeamAttendanceView from './TeamAttendanceView.vue';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const guard = (codes: string[], permission: string) =>
  evaluateGuard(
    { isAuthenticated: true, hasCompany: true, can: (c: string) => codes.includes(c) },
    { name: 'target', meta: { permission } },
  );

/** What a refusal looks like: the forbidden route, carrying the code the navigation wanted. */
const refused = (permission: string) => ({ name: 'forbidden', query: { code: permission } });

const DRAFT = { id: 'p-1', code: '2026-07', periodStart: '2026-07-01', periodEnd: '2026-07-31', status: 'DRAFT' };
const CLOSED = { ...DRAFT, id: 'p-2', code: '2026-06', status: 'CLOSED' };

const periodsView = (permissions: string[], initial: Record<string, unknown> = {}) =>
  mountView(AttendancePeriodsView, {
    path: '/attendance/periods',
    routeName: 'attendance-periods',
    permissions,
    extraRoutes: [{ path: '/attendance/periods/:id', name: 'attendance-period-detail' }],
    initialState: { attendanceHr: { periods: [DRAFT, CLOSED], periodTotal: 2, periodPage: 1, periodLimit: 20, ...initial } },
  });

describe('route gating', () => {
  it('keeps the period screen from someone without the period read', () => {
    expect(guard(['ATTEND_DAY_READ'], 'ATTEND_PERIOD_READ')).toEqual(refused('ATTEND_PERIOD_READ'));
  });

  it('lets each screen through on its own read code', () => {
    expect(guard(['ATTEND_PERIOD_READ'], 'ATTEND_PERIOD_READ')).toBeNull();
    expect(guard(['ATTEND_DAY_READ'], 'ATTEND_DAY_READ')).toBeNull();
    expect(guard(['ATTEND_PUNCH_READ'], 'ATTEND_PUNCH_READ')).toBeNull();
  });

  it('does not let a neighbour code stand in', () => {
    expect(guard(['ATTEND_PERIOD_READ'], 'ATTEND_PUNCH_READ')).toEqual(refused('ATTEND_PUNCH_READ'));
    expect(guard(['ATTEND_PUNCH_READ'], 'ATTEND_DAY_READ')).toEqual(refused('ATTEND_DAY_READ'));
  });

  it('does not let the self codes reach the HR screens', () => {
    // The whole point of the SELF/READ split: seeing your own attendance is not seeing everyone's.
    expect(guard(['ATTEND_DAY_SELF'], 'ATTEND_DAY_READ')).toEqual(refused('ATTEND_DAY_READ'));
    expect(guard(['ATTEND_PUNCH_SELF'], 'ATTEND_PUNCH_READ')).toEqual(refused('ATTEND_PUNCH_READ'));
  });
});

describe('AttendancePeriodsView', () => {
  it('lists periods for a plain reader', async () => {
    wrapper = await periodsView(['ATTEND_PERIOD_READ']);
    expect(wrapper.text()).toContain(la.attendance.hr.periods.title);
    expect(wrapper.text()).toContain('2026-07');
  });

  it('offers no close control without ATTEND_PERIOD_CLOSE', async () => {
    wrapper = await periodsView(['ATTEND_PERIOD_READ']);
    expect(wrapper.text()).not.toContain(la.attendance.hr.periods.close);
  });

  it('offers close to somebody who may close', async () => {
    wrapper = await periodsView(['ATTEND_PERIOD_READ', 'ATTEND_PERIOD_CLOSE']);
    expect(wrapper.text()).toContain(la.attendance.hr.periods.close);
  });

  it('does not let the close code reach reopening', async () => {
    // Closing is routine month-end work; reopening reaches into a period that may already be paid.
    wrapper = await periodsView(['ATTEND_PERIOD_READ', 'ATTEND_PERIOD_CLOSE']);
    expect(wrapper.text()).not.toContain(la.attendance.hr.periods.reopen);
  });

  it('offers reopen to somebody who holds its own code', async () => {
    wrapper = await periodsView(['ATTEND_PERIOD_READ', 'ATTEND_PERIOD_REOPEN']);
    expect(wrapper.text()).toContain(la.attendance.hr.periods.reopen);
  });

  it('offers no declare control without ATTEND_PERIOD_MANAGE', async () => {
    wrapper = await periodsView(['ATTEND_PERIOD_READ']);
    expect(wrapper.text()).not.toContain(la.attendance.hr.periods.declare);
  });

  it('reads coverage when a close is opened', async () => {
    wrapper = await periodsView(['ATTEND_PERIOD_READ', 'ATTEND_PERIOD_CLOSE']);
    const store = useAttendanceHrStore();
    const closeButton = wrapper.findAll('button').find((b) => b.text() === la.attendance.hr.periods.close);
    await closeButton!.trigger('click');
    // The figures are read BEFORE the confirmation, so nobody closes a month of zeros blind.
    expect(store.loadCoverage).toHaveBeenCalledWith('p-1');
  });
});

describe('the close confirmation', () => {
  const withCoverage = (coverage: Record<string, unknown>) =>
    periodsView(['ATTEND_PERIOD_READ', 'ATTEND_PERIOD_CLOSE'], { coverage: { 'p-1': coverage } });

  async function openClose(w: VueWrapper) {
    const button = w.findAll('button').find((b) => b.text() === la.attendance.hr.periods.close);
    await button!.trigger('click');
    await w.vm.$nextTick();
  }

  it('states the missing and stale figures apart', async () => {
    wrapper = await withCoverage({
      periodId: 'p-1', expectedEmployeeDays: 90, computedEmployeeDays: 60,
      missingEmployeeDays: 30, staleEmployeeDays: 4,
    });
    await openClose(wrapper);
    const text = document.body.textContent ?? '';
    // Two separate sentences: one is work never done, the other work overtaken by a later punch.
    expect(text).toContain('30');
    expect(text).toContain('4');
  });

  it('says a fully current period is current', async () => {
    wrapper = await withCoverage({
      periodId: 'p-1', expectedEmployeeDays: 90, computedEmployeeDays: 90,
      missingEmployeeDays: 0, staleEmployeeDays: 0,
    });
    await openClose(wrapper);
    expect(document.body.textContent).toContain(la.attendance.hr.periods.coverage.clean);
  });

  it('offers to recompute first when the range is not current', async () => {
    wrapper = await withCoverage({
      periodId: 'p-1', expectedEmployeeDays: 90, computedEmployeeDays: 0,
      missingEmployeeDays: 90, staleEmployeeDays: 0,
    });
    await openClose(wrapper);
    expect(document.body.textContent).toContain(la.attendance.hr.periods.coverage.recomputeFirst);
  });

  it('still lets the user close anyway', async () => {
    // A company whose staff are all exempt has a legitimately empty month; refusing to close it
    // would leave an honest period permanently open.
    wrapper = await withCoverage({
      periodId: 'p-1', expectedEmployeeDays: 90, computedEmployeeDays: 0,
      missingEmployeeDays: 90, staleEmployeeDays: 0,
    });
    await openClose(wrapper);
    expect(document.body.textContent).toContain(la.attendance.hr.periods.coverage.closeAnyway);
  });
});

describe('AttendancePeriodDetailView', () => {
  const LINE = {
    id: 'l-1',
    employee: { id: 'e-1', empCode: 'E1', fullName: 'Somebody' },
    employmentType: 'MONTHLY',
    attendanceAffectsPay: true,
    expectedMinutes: 480, workedMinutes: 470,
    daysPresent: 20, daysAbsent: 1, daysLeave: 2, daysNotWorked: 8,
    lateMinutes: 30, lateOccurrences: 3, earlyLeaveMinutes: 0,
    otNormalMinutes: 60, holidayWorkMinutes: 0, otHolidayMinutes: 0, uncertifiedOtMinutes: 15,
  };

  const detail = (initial: Record<string, unknown> = {}) =>
    mountView(AttendancePeriodDetailView, {
      path: '/attendance/periods/:id',
      routeName: 'attendance-period-detail',
      routeParams: { id: 'p-1' },
      permissions: ['ATTEND_PERIOD_READ'],
      initialState: {
        attendanceHr: {
          periods: [DRAFT],
          lines: [LINE],
          lineLeave: { 'l-1': [{ id: 'x', quota: { id: 'q', quotaType: 'SICK_LEAVE' }, days: '2.00' }] },
          log: [{ id: 'g1', action: 'CLOSE', actedBy: { id: 'u', username: 'hr' }, actedAt: '2026-08-01T00:00:00Z' }],
          closedEvents: [],
          ...initial,
        },
      },
    });

  it('shows lateness as minutes AND occurrences', async () => {
    wrapper = await detail();
    expect(wrapper.text()).toContain(la.attendance.hr.periodDetail.columns.lateMinutes);
    expect(wrapper.text()).toContain(la.attendance.hr.periodDetail.columns.lateOccurrences);
    expect(wrapper.text()).toContain('30');
    expect(wrapper.text()).toContain('3');
  });

  it('keeps the three overtime kinds in three columns', async () => {
    wrapper = await detail();
    expect(wrapper.text()).toContain(la.attendance.hr.periodDetail.columns.otNormal);
    expect(wrapper.text()).toContain(la.attendance.hr.periodDetail.columns.holidayWork);
    expect(wrapper.text()).toContain(la.attendance.hr.periodDetail.columns.otHoliday);
  });

  it('shows leave by type rather than as one number', async () => {
    wrapper = await detail();
    expect(wrapper.text()).toContain('SICK_LEAVE');
    expect(wrapper.text()).toContain('2.00');
  });

  it('shows the log with who acted', async () => {
    wrapper = await detail();
    expect(wrapper.text()).toContain(la.attendance.hr.periodDetail.log);
    expect(wrapper.text()).toContain('hr');
  });

  it('offers no control that edits a line', async () => {
    wrapper = await detail();
    // A line is produced by closing and replaced by re-closing; there is nothing to edit.
    expect(wrapper.text()).toContain(la.attendance.hr.periodDetail.derivedNote);
    const labels = wrapper.findAll('button').map((b) => b.text()).join(' ');
    expect(labels).not.toContain(la.common.save);
  });
});

describe('TeamAttendanceView', () => {
  const team = (permissions: string[]) =>
    mountView(TeamAttendanceView, {
      path: '/attendance/team',
      routeName: 'team-attendance',
      permissions,
      initialState: { attendanceHr: { teamDays: [], teamTotal: 0, teamPage: 1, teamLimit: 20, staleLeave: [] } },
    });

  it('offers no recompute control without the recompute code', async () => {
    wrapper = await team(['ATTEND_DAY_READ']);
    expect(wrapper.text()).not.toContain(la.attendance.hr.team.recomputeCompany);
  });

  it('offers recompute to somebody who may rebuild', async () => {
    wrapper = await team(['ATTEND_DAY_READ', 'ATTEND_DAY_RECOMPUTE']);
    expect(wrapper.text()).toContain(la.attendance.hr.team.recomputeCompany);
  });

  it('lists stale leave as outstanding work', async () => {
    wrapper = await mountView(TeamAttendanceView, {
      path: '/attendance/team',
      routeName: 'team-attendance',
      permissions: ['ATTEND_DAY_READ'],
      initialState: {
        attendanceHr: {
          teamDays: [], teamTotal: 0, teamPage: 1, teamLimit: 20,
          staleLeave: [{ employeeId: 'e1', date: '2026-07-15', documentId: 'd1', approvedAt: '2026-07-16T00:00:00Z' }],
        },
      },
    });
    expect(wrapper.text()).toContain(la.attendance.hr.team.staleLeave);
  });
});

describe('PunchLedgerView', () => {
  const PUNCH = {
    id: 'ev-1',
    employee: { id: 'e-1', fullName: 'Somebody' },
    occurredAt: '2026-07-15T01:00:00.000Z',
    localDate: '2026-07-15',
    direction: 'IN',
    source: 'MANUAL',
    geofenceStatus: 'UNKNOWN',
  };

  const ledger = (permissions: string[]) =>
    mountView(PunchLedgerView, {
      path: '/attendance/ledger',
      routeName: 'punch-ledger',
      permissions,
      initialState: { attendanceHr: { punches: [PUNCH], punchTotal: 1, punchPage: 1, punchLimit: 20 } },
    });

  it('offers no punch control without ATTEND_PUNCH_MANAGE', async () => {
    wrapper = await ledger(['ATTEND_PUNCH_READ']);
    expect(wrapper.text()).not.toContain(la.attendance.hr.ledger.punchFor);
    expect(wrapper.text()).not.toContain(la.attendance.hr.ledger.bulkPunch);
  });

  it('offers both punch controls to somebody who may enter on behalf', async () => {
    wrapper = await ledger(['ATTEND_PUNCH_READ', 'ATTEND_PUNCH_MANAGE']);
    expect(wrapper.text()).toContain(la.attendance.hr.ledger.punchFor);
    expect(wrapper.text()).toContain(la.attendance.hr.ledger.bulkPunch);
  });

  it('shows the source so a hand-entered punch is distinguishable', async () => {
    wrapper = await ledger(['ATTEND_PUNCH_READ']);
    expect(wrapper.text()).toContain('MANUAL');
  });

  it('starts a correction from the punch itself', async () => {
    wrapper = await ledger(['ATTEND_PUNCH_READ', 'ATTEND_PUNCH_MANAGE']);
    // The subject rides on the document because the correction begins at somebody's row, not at a
    // form with a "whose attendance is this" picker.
    expect(wrapper.text()).toContain(la.attendance.hr.ledger.correct);
  });
});

describe('self-service keeps no subject picker', () => {
  it('never gained a control naming another employee', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync('src/views/attendance/RequestCorrectionView.vue', 'utf8'),
    );
    // Filing on somebody's behalf goes through the ledger, so the self-service form stays unable to
    // name anyone — which is the property the correction slice's subject fix established.
    expect(source).not.toMatch(/employeeId/);
    expect(source).not.toMatch(/relatedEmployeeId/);
  });
});
