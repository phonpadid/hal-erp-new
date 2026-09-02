import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { items: [], total: 0, page: 1, limit: 20 } })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

import { api } from './client';
import { attendanceSelfApi, correctionSelfApi, leaveSelfApi } from './attendance';

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  get.mockClear();
  post.mockClear();
});

describe('attendanceSelfApi', () => {
  it('posts a punch with its coordinates as strings', async () => {
    await attendanceSelfApi.checkIn({
      source: 'MOBILE',
      latitude: '13.756331',
      longitude: '100.501765',
    });
    expect(post).toHaveBeenCalledWith('/attendance/check-in', {
      source: 'MOBILE',
      latitude: '13.756331',
      longitude: '100.501765',
    });
    const body = post.mock.calls[0][1];
    expect(typeof body.latitude).toBe('string');
    expect(typeof body.longitude).toBe('string');
  });

  it('posts a punch with no location at all when there is none', async () => {
    // A refused permission must not stop a punch, so an empty body is a valid punch.
    await attendanceSelfApi.checkOut({ source: 'WEB' });
    expect(post).toHaveBeenCalledWith('/attendance/check-out', { source: 'WEB' });
  });

  it('sends no date param when today is wanted', async () => {
    await attendanceSelfApi.myEvents();
    expect(get).toHaveBeenCalledWith('/attendance/events/me', { params: {} });
  });

  it('sends the date when one is given', async () => {
    await attendanceSelfApi.myEvents('2026-07-15');
    expect(get).toHaveBeenCalledWith('/attendance/events/me', { params: { date: '2026-07-15' } });
  });

  it('reads my days from the self route and drops empty filters', async () => {
    await attendanceSelfApi.myDays(2, 50, { dateFrom: '2026-07-01', status: '', dateTo: undefined });
    expect(get).toHaveBeenCalledWith('/attendance/days/me', {
      params: { page: 2, limit: 50, dateFrom: '2026-07-01' },
    });
  });

  it('never sends an employee id — the route resolves the caller', async () => {
    await attendanceSelfApi.myDays(1, 20, { employeeId: 'someone-else' } as never);
    const params = get.mock.calls[0][1].params;
    expect(params.employeeId).toBeUndefined();
  });
});

describe('leaveSelfApi', () => {
  it('previews a range from the self route, naming no employee', async () => {
    await leaveSelfApi.previewOwn({
      fromDate: '2026-07-01',
      toDate: '2026-07-03',
      fromHalf: 'PM',
      toHalf: '',
    });
    expect(get).toHaveBeenCalledWith('/leave-requests/preview/me', {
      params: { fromDate: '2026-07-01', toDate: '2026-07-03', fromHalf: 'PM' },
    });
    expect(get.mock.calls[0][1].params.employeeId).toBeUndefined();
  });

  it('submits through the capability own endpoint, not the generic one', async () => {
    // The leave document type carries derives_quantity, so the generic submit refuses it.
    await leaveSelfApi.submit('doc-1');
    expect(post).toHaveBeenCalledWith('/leave-requests/doc-1/submit', {});
  });
});

describe('correctionSelfApi', () => {
  it('reads my own correctable punches without naming an employee', async () => {
    await correctionSelfApi.myCorrectable('2026-07-15');
    expect(get).toHaveBeenCalledWith('/time-corrections/correctable/me', {
      params: { shiftDate: '2026-07-15' },
    });
  });

  it('posts the correction detail as given', async () => {
    const dto = {
      documentId: 'doc-1',
      shiftDate: '2026-07-15',
      kind: 'ADD' as const,
      requestedAt: '2026-07-15T10:00:00.000Z',
      requestedDirection: 'OUT' as const,
      reason: 'Forgot to scan out',
    };
    await correctionSelfApi.create(dto);
    expect(post).toHaveBeenCalledWith('/time-corrections', dto);
  });
});
