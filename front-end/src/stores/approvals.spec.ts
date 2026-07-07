import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApprovalsStore } from './approvals';
import { approvalsApi } from '../api/approvals';

vi.mock('../api/approvals', () => ({
  approvalsApi: { pending: vi.fn(), act: vi.fn() },
}));

const m = approvalsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('useApprovalsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('loadPending populates the inbox', async () => {
    m.pending.mockResolvedValueOnce({ items: [{ id: 'd1', docNo: 'PR-1' }], total: 1, page: 1, limit: 20 });
    const s = useApprovalsStore();
    await s.loadPending();
    expect(s.pending).toHaveLength(1);
    expect(s.total).toBe(1);
    expect(s.error).toBe('');
  });

  it('act success refreshes the inbox and returns true', async () => {
    m.act.mockResolvedValueOnce(undefined);
    m.pending.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20 });
    const s = useApprovalsStore();
    expect(await s.act('d1', 'APPROVE', 'ok')).toBe(true);
    expect(m.act).toHaveBeenCalledWith('d1', { action: 'APPROVE', remark: 'ok' });
    expect(m.pending).toHaveBeenCalled();
  });

  it('act failure surfaces the server message and returns false', async () => {
    m.act.mockRejectedValueOnce({ response: { data: { message: 'A document cannot be approved by its creator' } } });
    const s = useApprovalsStore();
    expect(await s.act('d1', 'APPROVE')).toBe(false);
    expect(s.error).toBe('A document cannot be approved by its creator');
  });
});
