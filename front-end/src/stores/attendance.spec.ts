import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/attendance', () => ({
  attendanceSelfApi: { checkIn: vi.fn(), checkOut: vi.fn(), myEvents: vi.fn(), myDays: vi.fn() },
  leaveSelfApi: { previewOwn: vi.fn(), create: vi.fn(), submit: vi.fn() },
  correctionSelfApi: { myCorrectable: vi.fn(), create: vi.fn() },
}));
vi.mock('../api/documents', () => ({
  documentsApi: { create: vi.fn(), submit: vi.fn() },
}));
vi.mock('../composables/useGeolocation', () => ({
  useGeolocation: () => ({ read: readMock, isAvailable: () => true }),
}));

const readMock = vi.fn(() => Promise.resolve({ status: 'granted', latitude: '13.756331', longitude: '100.501765' }));

import { attendanceSelfApi, correctionSelfApi, leaveSelfApi } from '../api/attendance';
import { documentsApi } from '../api/documents';
import { useAttendanceStore } from './attendance';

const punches = attendanceSelfApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const leave = leaveSelfApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const corrections = correctionSelfApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const docs = documentsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const event = (direction: 'IN' | 'OUT', at: string) => ({
  id: `e-${at}`,
  occurredAt: at,
  localDate: at.slice(0, 10),
  direction,
  source: 'WEB',
  geofenceStatus: 'UNKNOWN' as const,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  readMock.mockResolvedValue({ status: 'granted', latitude: '13.756331', longitude: '100.501765' });
});

describe('reading today', () => {
  it('loads the day punches', async () => {
    punches.myEvents.mockResolvedValueOnce([event('IN', '2026-07-15T01:00:00Z')]);
    const s = useAttendanceStore();
    await s.loadToday();
    expect(s.todayEvents).toHaveLength(1);
    expect(s.loading).toBe(false);
  });

  it('captures a failure as a message', async () => {
    punches.myEvents.mockRejectedValueOnce({ response: { data: { message: 'nope' } } });
    const s = useAttendanceStore();
    await s.loadToday();
    expect(s.error).toBe('nope');
  });

  it('says which way the employee is facing, from the last punch', async () => {
    const s = useAttendanceStore();
    punches.myEvents.mockResolvedValueOnce([event('IN', '2026-07-15T01:00:00Z')]);
    await s.loadToday();
    expect(s.isCheckedIn).toBe(true);

    punches.myEvents.mockResolvedValueOnce([
      event('IN', '2026-07-15T01:00:00Z'),
      event('OUT', '2026-07-15T10:00:00Z'),
    ]);
    await s.loadToday();
    expect(s.isCheckedIn).toBe(false);
  });

  it('is neither in nor out before the first punch', async () => {
    punches.myEvents.mockResolvedValueOnce([]);
    const s = useAttendanceStore();
    await s.loadToday();
    expect(s.isCheckedIn).toBe(false);
    expect(s.hasPunchedToday).toBe(false);
  });
});

describe('punching', () => {
  it('attaches the coordinates when the device gives them', async () => {
    punches.checkIn.mockResolvedValueOnce({});
    punches.myEvents.mockResolvedValueOnce([]);
    const s = useAttendanceStore();
    expect(await s.punch('IN')).toBe(true);
    expect(punches.checkIn).toHaveBeenCalledWith({
      source: 'WEB',
      latitude: '13.756331',
      longitude: '100.501765',
    });
    expect(s.locationStatus).toBe('granted');
  });

  it('punches anyway when the user denies location, and records why', async () => {
    // A refused permission must not lose an attendance record.
    readMock.mockResolvedValueOnce({ status: 'denied' } as never);
    punches.checkIn.mockResolvedValueOnce({});
    punches.myEvents.mockResolvedValueOnce([]);
    const s = useAttendanceStore();
    expect(await s.punch('IN')).toBe(true);
    expect(punches.checkIn).toHaveBeenCalledWith({ source: 'WEB' });
    expect(s.locationStatus).toBe('denied');
  });

  it('punches anyway when the browser has no geolocation', async () => {
    readMock.mockResolvedValueOnce({ status: 'unavailable' } as never);
    punches.checkOut.mockResolvedValueOnce({});
    punches.myEvents.mockResolvedValueOnce([]);
    const s = useAttendanceStore();
    expect(await s.punch('OUT')).toBe(true);
    expect(punches.checkOut).toHaveBeenCalledWith({ source: 'WEB' });
    expect(s.locationStatus).toBe('unavailable');
  });

  it('refreshes the day itself, so the view never fires a second read', async () => {
    punches.checkIn.mockResolvedValueOnce({});
    punches.myEvents.mockResolvedValueOnce([event('IN', '2026-07-15T01:00:00Z')]);
    const s = useAttendanceStore();
    await s.punch('IN');
    expect(punches.myEvents).toHaveBeenCalledTimes(1);
    expect(s.todayEvents).toHaveLength(1);
  });

  it('returns false and keeps the message when the punch is rejected', async () => {
    punches.checkIn.mockRejectedValueOnce({ response: { data: { message: 'Too soon' } } });
    const s = useAttendanceStore();
    expect(await s.punch('IN')).toBe(false);
    expect(s.error).toBe('Too soon');
    expect(s.punching).toBe(false);
  });
});

describe('my days', () => {
  it('mirrors the pagination triple', async () => {
    punches.myDays.mockResolvedValueOnce({
      items: [{ id: 'd1', shiftDate: '2026-07-01', lateMinutes: 10, lateOccurrences: 1 }],
      total: 31,
      page: 2,
      limit: 10,
    });
    const s = useAttendanceStore();
    await s.loadMyDays(2, 10);
    expect(s.total).toBe(31);
    expect(s.page).toBe(2);
    expect(s.myDays[0].lateOccurrences).toBe(1);
  });

  it('returns to the first page when the filters change', async () => {
    punches.myDays.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    const s = useAttendanceStore();
    await s.setFilters({ dateFrom: '2026-07-01' });
    expect(punches.myDays).toHaveBeenCalledWith(1, 20, { dateFrom: '2026-07-01' });
  });
});

describe('requesting leave', () => {
  it('creates, attaches and submits as one action', async () => {
    docs.create.mockResolvedValueOnce({ id: 'doc-1' });
    leave.create.mockResolvedValueOnce({});
    leave.submit.mockResolvedValueOnce({});
    const s = useAttendanceStore();

    const ok = await s.requestLeave('type-1', {
      quotaId: 'q1',
      fromDate: '2026-07-01',
      toDate: '2026-07-02',
      fromHalf: 'FULL',
      toHalf: 'FULL',
    });
    expect(ok).toBe(true);
    expect(docs.create).toHaveBeenCalledWith({ documentTypeId: 'type-1' });
    expect(leave.create).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'doc-1' }));
    // Through leave's own endpoint: the type carries derives_quantity and the generic one refuses it.
    expect(leave.submit).toHaveBeenCalledWith('doc-1');
    expect(s.failedStep).toBe('');
  });

  it('names the step that failed', async () => {
    docs.create.mockResolvedValueOnce({ id: 'doc-1' });
    leave.create.mockResolvedValueOnce({});
    leave.submit.mockRejectedValueOnce({ response: { data: { message: 'Quota exhausted' } } });
    const s = useAttendanceStore();

    expect(
      await s.requestLeave('type-1', {
        quotaId: 'q1',
        fromDate: '2026-07-01',
        toDate: '2026-07-02',
        fromHalf: 'FULL',
        toHalf: 'FULL',
      }),
    ).toBe(false);
    // "We created your document but could not submit it" is actionable; "request failed" is not.
    expect(s.failedStep).toBe('submit');
    expect(s.error).toBe('Quota exhausted');
  });

  it('previews the charge, and stays quiet when it cannot', async () => {
    leave.previewOwn.mockResolvedValueOnce({ totalDays: '4.00', perDate: [] });
    const s = useAttendanceStore();
    await s.previewLeave({ fromDate: '2026-07-01', toDate: '2026-07-05' });
    expect(s.leavePreview?.totalDays).toBe('4.00');

    leave.previewOwn.mockRejectedValueOnce(new Error('boom'));
    await s.previewLeave({ fromDate: '2026-07-01', toDate: '2026-07-05' });
    expect(s.leavePreview).toBeNull();
    expect(s.error).toBe('');
  });

  it('does not preview a half-filled range', async () => {
    const s = useAttendanceStore();
    await s.previewLeave({ fromDate: '2026-07-01', toDate: '' });
    expect(leave.previewOwn).not.toHaveBeenCalled();
  });
});

describe('requesting a correction', () => {
  it('sends no employee — the document decides whose attendance it is', async () => {
    docs.create.mockResolvedValueOnce({ id: 'doc-2' });
    corrections.create.mockResolvedValueOnce({});
    docs.submit.mockResolvedValueOnce({});
    const s = useAttendanceStore();

    const ok = await s.requestCorrection('type-2', {
      shiftDate: '2026-07-15',
      kind: 'ADD',
      requestedAt: '2026-07-15T10:00:00.000Z',
      requestedDirection: 'OUT',
      reason: 'Forgot to scan out',
    });
    expect(ok).toBe(true);
    const sent = corrections.create.mock.calls[0][0];
    expect(sent.employeeId).toBeUndefined();
    // A correction derives no quantity, so the generic submit is exactly right for it.
    expect(docs.submit).toHaveBeenCalledWith('doc-2');
  });

  it('loads the punches a correction could name', async () => {
    corrections.myCorrectable.mockResolvedValueOnce([event('IN', '2026-07-15T01:00:00Z')]);
    const s = useAttendanceStore();
    await s.loadCorrectablePunches('2026-07-15');
    expect(s.correctablePunches).toHaveLength(1);
  });

  it('asks for nothing when no day is chosen yet', async () => {
    const s = useAttendanceStore();
    await s.loadCorrectablePunches('');
    expect(corrections.myCorrectable).not.toHaveBeenCalled();
    expect(s.correctablePunches).toEqual([]);
  });
});
