import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuotaStore } from './quota';
import { quotasApi } from '../api/quotas';
import { deriveRemaining } from '../utils/quota';

vi.mock('../api/quotas', () => ({
  quotasApi: { list: vi.fn(), get: vi.fn(), breakdown: vi.fn(), usage: vi.fn() },
}));

const m = quotasApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('deriveRemaining', () => {
  it('computes entitled − used exactly', () => {
    expect(deriveRemaining('12', '2')).toBe('10');
    expect(deriveRemaining('1.5', '0.3')).toBe('1.2');
  });
});

describe('useQuotaStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('loadList populates rows with the pool remaining', async () => {
    // `remaining` now arrives inline on each list row (computed server-side), so loadList no
    // longer makes a per-row breakdown call.
    m.list.mockResolvedValueOnce({ items: [{ id: 'q1', quotaType: 'ANNUAL_LEAVE', unit: 'day', remaining: '10' }], total: 1, page: 1, limit: 20 });
    const s = useQuotaStore();
    await s.loadList();
    expect(s.list).toHaveLength(1);
    expect(s.list[0].remaining).toBe('10');
    expect(m.breakdown).not.toHaveBeenCalled();
  });

  it('loadOne sets current, breakdown and usage', async () => {
    m.get.mockResolvedValueOnce({ id: 'q1' });
    m.breakdown.mockResolvedValueOnce({ quota: { unit: 'day' }, pool: { remaining: '10' }, entitlements: [] });
    m.usage.mockResolvedValueOnce({ items: [{ id: 'u1', usageType: 'USE', qtyUsed: '2' }], total: 1, page: 1, limit: 20 });
    const s = useQuotaStore();
    await s.loadOne('q1');
    expect(s.current.id).toBe('q1');
    expect(s.breakdown?.pool.remaining).toBe('10');
    expect(s.usage).toHaveLength(1);
  });

  it('captures an error', async () => {
    m.list.mockRejectedValueOnce({ response: { data: { message: 'nope' } } });
    const s = useQuotaStore();
    await s.loadList();
    expect(s.error).toBe('nope');
  });
});
