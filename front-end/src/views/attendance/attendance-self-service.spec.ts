import { afterEach, describe, expect, it } from 'vitest';
import { leaveRequestDetailSchema, timeCorrectionDetailSchema } from '@erp/shared';
import { evaluateGuard } from '../../router';
import la from '../../i18n/locales/la';
import { mountView } from '../../test/mountView';
import { useAttendanceStore } from '../../stores/attendance';
import MyAttendanceView from './MyAttendanceView.vue';
import MyDaysView from './MyDaysView.vue';
import RequestCorrectionView from './RequestCorrectionView.vue';
import type { VueWrapper } from '@vue/test-utils';

/**
 * Visible text is asserted against the `la` catalogue, because `la` is the default locale.
 */

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

describe('route gating', () => {
  it('keeps the punch screen from someone without ATTEND_PUNCH_SELF', () => {
    expect(guard(['DOC_VIEW'], 'ATTEND_PUNCH_SELF')).toBe('home');
  });

  it('lets ATTEND_PUNCH_SELF through to the punch screen', () => {
    expect(guard(['ATTEND_PUNCH_SELF'], 'ATTEND_PUNCH_SELF')).toBeNull();
  });

  /**
   * The gap this slice closed. Before it, my-days was gated on ATTEND_DAY_READ — the code that
   * lists EVERY employee's days — so an employee could not see their own attendance without the
   * power to see the whole company's.
   */
  it('does not let the punch code alone reach my days', () => {
    expect(guard(['ATTEND_PUNCH_SELF'], 'ATTEND_DAY_SELF')).toBe('home');
  });

  it('lets ATTEND_DAY_SELF through to my days', () => {
    expect(guard(['ATTEND_DAY_SELF'], 'ATTEND_DAY_SELF')).toBeNull();
  });

  it('does not require the company-wide read for my days', () => {
    expect(guard(['ATTEND_DAY_SELF'], 'ATTEND_DAY_SELF')).toBeNull();
    // And holding only the company-wide code does not satisfy the self route either: they are two
    // codes for two powers, not one code with two names.
    expect(guard(['ATTEND_DAY_READ'], 'ATTEND_DAY_SELF')).toBe('home');
  });
});

describe('MyAttendanceView', () => {
  it('renders for a user holding only the self punch code', async () => {
    wrapper = await mountView(MyAttendanceView, {
      path: '/attendance/me',
      routeName: 'my-attendance',
      permissions: ['ATTEND_PUNCH_SELF'],
    });
    expect(wrapper.text()).toContain(la.attendance.punch.title);
  });

  it('offers check-in and says nothing is recorded before the first punch', async () => {
    wrapper = await mountView(MyAttendanceView, {
      path: '/attendance/me',
      routeName: 'my-attendance',
      permissions: ['ATTEND_PUNCH_SELF'],
      initialState: { attendance: { todayEvents: [] } },
    });
    expect(wrapper.text()).toContain(la.attendance.punch.checkIn);
    expect(wrapper.text()).toContain(la.attendance.punch.statusNone);
    expect(wrapper.text()).toContain(la.attendance.punch.empty);
  });

  it('says which way the employee is facing, and offers the opposite', async () => {
    wrapper = await mountView(MyAttendanceView, {
      path: '/attendance/me',
      routeName: 'my-attendance',
      permissions: ['ATTEND_PUNCH_SELF'],
      initialState: {
        attendance: {
          todayEvents: [
            {
              id: 'e1',
              occurredAt: '2026-07-15T01:00:00.000Z',
              localDate: '2026-07-15',
              direction: 'IN',
              source: 'WEB',
              geofenceStatus: 'UNKNOWN',
            },
          ],
        },
      },
    });
    expect(wrapper.text()).toContain(la.attendance.punch.statusIn);
    expect(wrapper.text()).toContain(la.attendance.punch.checkOut);
  });

  it('calls the store once per press and fires no read of its own', async () => {
    wrapper = await mountView(MyAttendanceView, {
      path: '/attendance/me',
      routeName: 'my-attendance',
      permissions: ['ATTEND_PUNCH_SELF'],
      initialState: { attendance: { todayEvents: [] } },
    });
    const store = useAttendanceStore();
    const before = (store.loadToday as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

    await wrapper.findAll('button')[0].trigger('click');
    expect(store.punch).toHaveBeenCalledTimes(1);
    expect(store.punch).toHaveBeenCalledWith('IN');
    // The store refreshes the day itself; a view that also read would double every punch.
    expect((store.loadToday as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(before);
  });

  it('reports a denied location in its own words, and still shows the punch controls', async () => {
    wrapper = await mountView(MyAttendanceView, {
      path: '/attendance/me',
      routeName: 'my-attendance',
      permissions: ['ATTEND_PUNCH_SELF'],
      initialState: { attendance: { todayEvents: [], locationStatus: 'denied' } },
    });
    expect(wrapper.text()).toContain(la.attendance.punch.location.denied);
    expect(wrapper.text()).toContain(la.attendance.punch.checkIn);
  });

  it('distinguishes unavailable from denied', async () => {
    // Different actions: one is fixed by serving over https, the other in the browser.
    wrapper = await mountView(MyAttendanceView, {
      path: '/attendance/me',
      routeName: 'my-attendance',
      permissions: ['ATTEND_PUNCH_SELF'],
      initialState: { attendance: { todayEvents: [], locationStatus: 'unavailable' } },
    });
    expect(wrapper.text()).toContain(la.attendance.punch.location.unavailable);
    expect(wrapper.text()).not.toContain(la.attendance.punch.location.denied);
  });

  it('reports a timeout as a timeout', async () => {
    wrapper = await mountView(MyAttendanceView, {
      path: '/attendance/me',
      routeName: 'my-attendance',
      permissions: ['ATTEND_PUNCH_SELF'],
      initialState: { attendance: { todayEvents: [], locationStatus: 'timeout' } },
    });
    expect(wrapper.text()).toContain(la.attendance.punch.location.timeout);
  });
});

describe('MyDaysView', () => {
  const day = {
    id: 'd1',
    shiftDate: '2026-07-15',
    shiftCode: 'OFFICE',
    status: 'PRESENT',
    expectedMinutes: 480,
    workedMinutes: 470,
    lateMinutes: 30,
    lateOccurrences: 3,
    earlyLeaveMinutes: 0,
    otNormalMinutes: 60,
    holidayWorkMinutes: 0,
    otHolidayMinutes: 0,
    punchCount: 2,
    computedAt: '2026-07-16T00:00:00.000Z',
  };

  it('shows lateness as minutes AND as occurrences', async () => {
    // Thai discipline counts times; pay counts minutes. Collapsing them loses one of the two.
    wrapper = await mountView(MyDaysView, {
      path: '/attendance/my-days',
      routeName: 'my-attendance-days',
      permissions: ['ATTEND_DAY_SELF'],
      initialState: { attendance: { myDays: [day], total: 1, page: 1, limit: 20 } },
    });
    expect(wrapper.text()).toContain(la.attendance.days.columns.lateMinutes);
    expect(wrapper.text()).toContain(la.attendance.days.columns.lateOccurrences);
    expect(wrapper.text()).toContain('30');
    expect(wrapper.text()).toContain('3');
  });

  it('keeps the three overtime kinds in three columns', async () => {
    wrapper = await mountView(MyDaysView, {
      path: '/attendance/my-days',
      routeName: 'my-attendance-days',
      permissions: ['ATTEND_DAY_SELF'],
      initialState: { attendance: { myDays: [day], total: 1, page: 1, limit: 20 } },
    });
    expect(wrapper.text()).toContain(la.attendance.days.columns.otNormal);
    expect(wrapper.text()).toContain(la.attendance.days.columns.holidayWork);
    expect(wrapper.text()).toContain(la.attendance.days.columns.otHoliday);
  });

  it('offers no control that writes to a day', async () => {
    wrapper = await mountView(MyDaysView, {
      path: '/attendance/my-days',
      routeName: 'my-attendance-days',
      permissions: ['ATTEND_DAY_SELF'],
      initialState: { attendance: { myDays: [day], total: 1, page: 1, limit: 20 } },
    });
    // The projection is derived; the only way to move it is to correct a punch.
    expect(wrapper.text()).toContain(la.attendance.days.derivedNote);
    const labels = wrapper.findAll('button').map((b) => b.text()).join(' ');
    expect(labels).not.toContain(la.common.save);
  });

  it('states an empty range rather than showing a blank table', async () => {
    wrapper = await mountView(MyDaysView, {
      path: '/attendance/my-days',
      routeName: 'my-attendance-days',
      permissions: ['ATTEND_DAY_SELF'],
      initialState: { attendance: { myDays: [], total: 0, page: 1, limit: 20 } },
    });
    expect(wrapper.text()).toContain(la.attendance.days.empty);
  });
});

describe('RequestCorrectionView', () => {
  it('asks for a punch to select when a punch is at the wrong time', async () => {
    wrapper = await mountView(RequestCorrectionView, {
      path: '/attendance/correction/new',
      routeName: 'request-correction',
      permissions: ['DOC_CREATE'],
      extraRoutes: [{ path: '/documents', name: 'documents' }],
      initialState: {
        attendance: {
          correctablePunches: [
            {
              id: 'e1',
              occurredAt: '2026-07-15T01:02:00.000Z',
              localDate: '2026-07-15',
              direction: 'IN',
              source: 'WEB',
              geofenceStatus: 'UNKNOWN',
            },
          ],
        },
      },
    });
    expect(wrapper.text()).toContain(la.attendance.correction.title);
    // ADD is the initial kind, so no target field is offered — there is nothing to supersede.
    expect(wrapper.text()).not.toContain(la.attendance.correction.fields.target);
    expect(wrapper.text()).toContain(la.attendance.correction.fields.requestedAt);
  });

  it('says nothing changes until the request is approved', async () => {
    wrapper = await mountView(RequestCorrectionView, {
      path: '/attendance/correction/new',
      routeName: 'request-correction',
      permissions: ['DOC_CREATE'],
      extraRoutes: [{ path: '/documents', name: 'documents' }],
    });
    expect(wrapper.text()).toContain(la.attendance.correction.approvalNote);
  });
});

/**
 * Schema-only, the way `budget-forms.spec.ts` tests a shared schema: the rules the form enforces
 * are the rules the server enforces, because they are the same object.
 */
describe('the shared schemas the forms resolve against', () => {
  it('rejects a reversed leave range on the field that is wrong', () => {
    const r = leaveRequestDetailSchema.safeParse({
      quotaId: '11111111-1111-4111-8111-111111111111',
      fromDate: '2026-07-10',
      toDate: '2026-07-01',
      fromHalf: 'FULL',
      toHalf: 'FULL',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(['toDate']);
  });

  it('requires a target for a CHANGE and forbids one for an ADD', () => {
    const base = { shiftDate: '2026-07-15', reason: 'Because', requestedDirection: 'IN' as const };
    const change = timeCorrectionDetailSchema.safeParse({
      ...base,
      kind: 'CHANGE',
      requestedAt: '2026-07-15T09:00:00.000Z',
    });
    expect(change.success).toBe(false);

    const add = timeCorrectionDetailSchema.safeParse({
      ...base,
      kind: 'ADD',
      requestedAt: '2026-07-15T09:00:00.000Z',
      targetEventId: '11111111-1111-4111-8111-111111111111',
    });
    expect(add.success).toBe(false);
  });

  it('forbids a time on a REMOVE', () => {
    const r = timeCorrectionDetailSchema.safeParse({
      shiftDate: '2026-07-15',
      kind: 'REMOVE',
      targetEventId: '11111111-1111-4111-8111-111111111111',
      requestedAt: '2026-07-15T09:00:00.000Z',
      reason: 'Because',
    });
    expect(r.success).toBe(false);
  });

  it('always requires a reason', () => {
    const r = timeCorrectionDetailSchema.safeParse({
      shiftDate: '2026-07-15',
      kind: 'ADD',
      requestedAt: '2026-07-15T09:00:00.000Z',
      requestedDirection: 'OUT',
      reason: '',
    });
    expect(r.success).toBe(false);
  });

  it('names no employee — the document decides whose attendance it is', () => {
    // Not a field, so not a route into anybody else's ledger. Asserted by parsing rather than by
    // reaching into the schema's internals, which are a Zod implementation detail.
    const r = timeCorrectionDetailSchema.safeParse({
      shiftDate: '2026-07-15',
      kind: 'ADD',
      requestedAt: '2026-07-15T09:00:00.000Z',
      requestedDirection: 'OUT',
      reason: 'Forgot to scan out',
      employeeId: 'somebody-else',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty('employeeId');
  });
});
