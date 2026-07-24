import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { items: [], total: 0, page: 1, limit: 20 } })),
    post: vi.fn(() => Promise.resolve({ data: {} })),
    put: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

import { api } from './client';
import { attendancePeriodsApi, punchLedgerApi, teamAttendanceApi } from './attendanceHr';

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const post = api.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  get.mockClear();
  post.mockClear();
});

describe('attendancePeriodsApi', () => {
  it('reads coverage before closing', async () => {
    await attendancePeriodsApi.coverage('p-1');
    expect(get).toHaveBeenCalledWith('/attendance-periods/p-1/coverage');
  });

  it('reads closed events as a page, not as a capped list', async () => {
    await attendancePeriodsApi.closedEvents(2, 50);
    expect(get).toHaveBeenCalledWith('/attendance-periods/closed-events', {
      params: { page: 2, limit: 50 },
    });
  });

  it('sends the reason with a reopen', async () => {
    await attendancePeriodsApi.reopen('p-1', 'A correction surfaced');
    expect(post).toHaveBeenCalledWith('/attendance-periods/p-1/reopen', {
      reason: 'A correction surfaced',
    });
  });

  it('drops an empty status filter rather than sending a blank', async () => {
    await attendancePeriodsApi.list(1, 20, '');
    expect(get).toHaveBeenCalledWith('/attendance-periods', { params: { page: 1, limit: 20 } });
  });
});

describe('teamAttendanceApi', () => {
  it('recomputes a company across a range', async () => {
    await teamAttendanceApi.recomputeCompany('2026-07-01', '2026-07-31');
    expect(post).toHaveBeenCalledWith('/attendance/days/recompute/company', {
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });
  });

  it('omits the end date when only one day is wanted', async () => {
    // Absent `dateTo` means the start date alone — exactly what the endpoint meant before ranges.
    await teamAttendanceApi.recomputeCompany('2026-07-01');
    expect(post).toHaveBeenCalledWith('/attendance/days/recompute/company', {
      dateFrom: '2026-07-01',
    });
  });

  it('reads everyone days from the general route, filtered', async () => {
    await teamAttendanceApi.days(1, 20, { employeeId: 'e-1', status: '', dateFrom: '2026-07-01' });
    expect(get).toHaveBeenCalledWith('/attendance/days', {
      params: { page: 1, limit: 20, employeeId: 'e-1', dateFrom: '2026-07-01' },
    });
  });
});

describe('punchLedgerApi', () => {
  it('records a punch for a named employee', async () => {
    await punchLedgerApi.punchFor({
      employeeId: 'e-1',
      occurredAt: '2026-07-15T01:00:00.000Z',
      direction: 'IN',
    });
    expect(post).toHaveBeenCalledWith('/attendance/events', {
      employeeId: 'e-1',
      occurredAt: '2026-07-15T01:00:00.000Z',
      direction: 'IN',
    });
  });

  it('records one instant for a whole crew', async () => {
    await punchLedgerApi.bulkPunch({
      employeeIds: ['e-1', 'e-2'],
      occurredAt: '2026-07-15T01:00:00.000Z',
      direction: 'IN',
    });
    expect(post).toHaveBeenCalledWith('/attendance/events/bulk', {
      employeeIds: ['e-1', 'e-2'],
      occurredAt: '2026-07-15T01:00:00.000Z',
      direction: 'IN',
    });
  });

  it('reads another employee correctable punches from the parameterised route', async () => {
    await punchLedgerApi.correctable('e-1', '2026-07-15');
    expect(get).toHaveBeenCalledWith('/time-corrections/correctable', {
      params: { employeeId: 'e-1', shiftDate: '2026-07-15' },
    });
  });

  it('sends a correction that names no employee of its own', async () => {
    await punchLedgerApi.createCorrection({
      documentId: 'doc-1',
      shiftDate: '2026-07-15',
      kind: 'REMOVE',
      targetEventId: '11111111-1111-4111-8111-111111111111',
      reason: 'Scanned twice',
    });
    const body = post.mock.calls[0][1];
    // Whose attendance it corrects comes from the document, where approvers can see it.
    expect(body.employeeId).toBeUndefined();
  });
});
