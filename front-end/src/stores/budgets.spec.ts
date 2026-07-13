import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBudgetsStore } from './budgets';
import { budgetsApi } from '../api/budgets';

vi.mock('../api/budgets', () => ({
  budgetsApi: {
    list: vi.fn(), get: vi.fn(), breakdown: vi.fn(), ledger: vi.fn(),
    create: vi.fn(), update: vi.fn(), createTransfer: vi.fn(),
  },
}));

const m = budgetsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('useBudgetsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('loadList populates rows with the derived available', async () => {
    m.list.mockResolvedValueOnce({ items: [{ id: 'b1', glAccount: '5000', amountTotal: '1000', status: 'ACTIVE' }], total: 1, page: 1, limit: 20 });
    m.breakdown.mockResolvedValueOnce({ available: '750' });
    const s = useBudgetsStore();
    await s.loadList();
    expect(s.list).toHaveLength(1);
    expect(s.list[0].available).toBe('750');
  });

  it('loadOne sets current, breakdown and ledger', async () => {
    m.get.mockResolvedValueOnce({ id: 'b1', glAccount: '5000' });
    m.breakdown.mockResolvedValueOnce({ amountTotal: '1000', available: '750' });
    // The ledger API returns a Paginated page; the store reads res.items.
    m.ledger.mockResolvedValueOnce({ items: [{ id: 't1', txnType: 'RESERVE', amount: '250' }], total: 1, page: 1, limit: 20 });
    const s = useBudgetsStore();
    await s.loadOne('b1');
    expect(s.current.id).toBe('b1');
    expect(s.breakdown?.available).toBe('750');
    expect(s.ledger).toHaveLength(1);
  });

  it('captures an error', async () => {
    m.list.mockRejectedValueOnce({ response: { data: { message: 'nope' } } });
    const s = useBudgetsStore();
    await s.loadList();
    expect(s.error).toBe('nope');
  });

  it('createBudget returns the created budget and forwards the input', async () => {
    m.create.mockResolvedValueOnce({ id: 'b9' });
    const s = useBudgetsStore();
    const input = { fiscalYearId: 'fy', departmentId: 'd', glAccount: '5000', amountTotal: '1000', controlPolicy: 'HARD_STOP' as const };
    const created = await s.createBudget(input);
    expect(created.id).toBe('b9');
    expect(m.create).toHaveBeenCalledWith(input);
  });

  it('updateBudget patches name/policy/status (never amountTotal)', async () => {
    m.update.mockResolvedValueOnce({ id: 'b1' });
    const s = useBudgetsStore();
    await s.updateBudget('b1', { budgetName: 'Renamed', status: 'INACTIVE' });
    expect(m.update).toHaveBeenCalledWith('b1', { budgetName: 'Renamed', status: 'INACTIVE' });
  });

  it('createTransfer returns the new document id', async () => {
    m.createTransfer.mockResolvedValueOnce({ documentId: 'doc-1' });
    const s = useBudgetsStore();
    const res = await s.createTransfer({ fromBudgetId: 'x', toBudgetId: 'y', amount: '100', reason: 'move' });
    expect(res.documentId).toBe('doc-1');
  });

  it('rethrows and records the error on a failed action', async () => {
    m.createTransfer.mockRejectedValueOnce({ response: { data: { message: 'over budget' } } });
    const s = useBudgetsStore();
    await expect(s.createTransfer({ fromBudgetId: 'x', toBudgetId: 'y', amount: '100', reason: 'm' })).rejects.toBeTruthy();
    expect(s.error).toBe('over budget');
  });
});
