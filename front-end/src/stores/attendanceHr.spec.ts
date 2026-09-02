import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/attendanceHr', () => ({
  attendancePeriodsApi: {
    list: vi.fn(), lines: vi.fn(), lineLeave: vi.fn(), log: vi.fn(), coverage: vi.fn(),
    closedEvents: vi.fn(), declare: vi.fn(), update: vi.fn(), close: vi.fn(), reopen: vi.fn(),
  },
  teamAttendanceApi: {
    days: vi.fn(), recomputeEmployee: vi.fn(), recomputeCompany: vi.fn(), staleLeaveDays: vi.fn(),
  },
  punchLedgerApi: {
    list: vi.fn(), punchFor: vi.fn(), bulkPunch: vi.fn(), correctable: vi.fn(), createCorrection: vi.fn(),
  },
}));
vi.mock('../api/documents', () => ({ documentsApi: { create: vi.fn(), submit: vi.fn() } }));

import { attendancePeriodsApi, punchLedgerApi, teamAttendanceApi } from '../api/attendanceHr';
import { documentsApi } from '../api/documents';
import { useAttendanceHrStore } from './attendanceHr';

const periods = attendancePeriodsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const team = teamAttendanceApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ledger = punchLedgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const docs = documentsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const page = <T>(items: T[]) => ({ items, total: items.length, page: 1, limit: 20 });

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  periods.list.mockResolvedValue(page([]));
  team.days.mockResolvedValue(page([]));
  ledger.list.mockResolvedValue(page([]));
});

describe('periods', () => {
  it('mirrors the pagination triple', async () => {
    periods.list.mockResolvedValueOnce({
      items: [{ id: 'p1', code: '2026-07', periodStart: '2026-07-01', periodEnd: '2026-07-31', status: 'DRAFT' }],
      total: 5, page: 2, limit: 10,
    });
    const s = useAttendanceHrStore();
    await s.loadPeriods(2, 10);
    expect(s.periodTotal).toBe(5);
    expect(s.periods[0].code).toBe('2026-07');
  });

  it('keeps the two coverage figures apart', async () => {
    periods.coverage.mockResolvedValueOnce({
      periodId: 'p1', expectedEmployeeDays: 90, computedEmployeeDays: 60,
      missingEmployeeDays: 30, staleEmployeeDays: 4,
    });
    const s = useAttendanceHrStore();
    await s.loadCoverage('p1');
    // One is work never done, the other work overtaken. A single total would hide which.
    expect(s.coverage.p1.missingEmployeeDays).toBe(30);
    expect(s.coverage.p1.staleEmployeeDays).toBe(4);
  });

  it('leaves coverage absent rather than zeroed when it cannot be read', async () => {
    periods.coverage.mockRejectedValueOnce(new Error('nope'));
    const s = useAttendanceHrStore();
    await s.loadCoverage('p1');
    // Absent means unknown; zero would claim the period is current.
    expect(s.coverage.p1).toBeUndefined();
  });

  it('reloads the list after closing, so the view fires no second read', async () => {
    periods.close.mockResolvedValueOnce({});
    const s = useAttendanceHrStore();
    expect(await s.closePeriod('p1')).toBe(true);
    expect(periods.list).toHaveBeenCalledTimes(1);
  });

  it('sends the reason with a reopen and reports a refusal', async () => {
    periods.reopen.mockRejectedValueOnce({ response: { data: { message: 'not closed' } } });
    const s = useAttendanceHrStore();
    expect(await s.reopenPeriod('p1', 'A correction surfaced')).toBe(false);
    expect(s.error).toBe('not closed');
  });

  it('loads a period detail with its leave rows per line', async () => {
    periods.lines.mockResolvedValueOnce([{ id: 'l1' }, { id: 'l2' }]);
    periods.log.mockResolvedValueOnce([{ id: 'g1', action: 'CLOSE' }]);
    periods.lineLeave.mockResolvedValueOnce([{ id: 'x', days: '2.00' }]).mockResolvedValueOnce([]);
    const s = useAttendanceHrStore();
    await s.loadPeriodDetail('p1');
    expect(s.lines).toHaveLength(2);
    expect(s.lineLeave.l1[0].days).toBe('2.00');
    expect(s.log[0].action).toBe('CLOSE');
  });

  it('reads closed events as a page with its total', async () => {
    periods.closedEvents.mockResolvedValueOnce({ items: [{ id: 'e1' }], total: 750, page: 1, limit: 20 });
    const s = useAttendanceHrStore();
    await s.loadClosedEvents();
    // The total is the point: a capped list that does not say so reads as a complete one.
    expect(s.closedEventTotal).toBe(750);
  });
});

describe('team days', () => {
  it('returns to the first page when filters change', async () => {
    const s = useAttendanceHrStore();
    await s.setTeamFilters({ employeeId: 'e-1' });
    expect(team.days).toHaveBeenCalledWith(1, 20, { employeeId: 'e-1' });
  });

  it('reports how many employee-days a company recompute wrote', async () => {
    team.recomputeCompany.mockResolvedValueOnce({ dateFrom: '2026-07-01', dateTo: '2026-07-31', employeeDays: 620 });
    const s = useAttendanceHrStore();
    expect(await s.recomputeCompany('2026-07-01', '2026-07-31')).toBe(620);
  });

  it('surfaces the server closed-period refusal verbatim', async () => {
    team.recomputeCompany.mockRejectedValueOnce({
      response: { data: { message: "2026-07-15 falls inside the closed period '2026-07'" } },
    });
    const s = useAttendanceHrStore();
    expect(await s.recomputeCompany('2026-07-01', '2026-07-31')).toBeNull();
    // The client does not reimplement the closed-period rule; it shows what the server said.
    expect(s.error).toContain("closed period '2026-07'");
  });

  it('stays quiet when the stale-leave read fails', async () => {
    team.staleLeaveDays.mockRejectedValueOnce(new Error('boom'));
    const s = useAttendanceHrStore();
    await s.loadStaleLeave();
    expect(s.staleLeave).toEqual([]);
    expect(s.error).toBe('');
  });
});

describe('punch ledger', () => {
  it('reloads after a punch on behalf', async () => {
    ledger.punchFor.mockResolvedValueOnce({});
    const s = useAttendanceHrStore();
    expect(await s.punchFor({ employeeId: 'e-1', occurredAt: 'x', direction: 'IN' })).toBe(true);
    expect(ledger.list).toHaveBeenCalledTimes(1);
  });

  it('sends a bulk punch for the whole crew', async () => {
    ledger.bulkPunch.mockResolvedValueOnce({});
    const s = useAttendanceHrStore();
    await s.bulkPunch({ employeeIds: ['e-1', 'e-2'], occurredAt: 'x', direction: 'IN' });
    expect(ledger.bulkPunch).toHaveBeenCalledWith(
      expect.objectContaining({ employeeIds: ['e-1', 'e-2'] }),
    );
  });

  it('puts the subject on the DOCUMENT, and none in the correction body', async () => {
    docs.create.mockResolvedValueOnce({ id: 'doc-9' });
    ledger.createCorrection.mockResolvedValueOnce({});
    docs.submit.mockResolvedValueOnce({});
    const s = useAttendanceHrStore();

    const ok = await s.requestCorrectionFor('type-1', 'emp-7', {
      shiftDate: '2026-07-15',
      kind: 'REMOVE',
      targetEventId: '11111111-1111-4111-8111-111111111111',
      reason: 'Scanned twice',
    });
    expect(ok).toBe(true);
    // Visible to every approver, rather than a value in a body nobody downstream reads.
    expect(docs.create).toHaveBeenCalledWith({ documentTypeId: 'type-1', relatedEmployeeId: 'emp-7' });
    expect(ledger.createCorrection.mock.calls[0][0].employeeId).toBeUndefined();
    expect(docs.submit).toHaveBeenCalledWith('doc-9');
  });
});
