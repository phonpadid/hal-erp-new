import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBudgetsStore } from './budgets';
import { budgetsApi } from '../api/budgets';

vi.mock('../api/budgets', () => ({
  budgetsApi: { updateControlPoint: vi.fn(), controlPointList: vi.fn() },
}));

const m = budgetsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

const row = (id: string, action: 'BLOCK' | 'WARN') => ({
  id,
  fiscalYearId: 'fy1',
  budgetNodeId: `n-${id}`,
  budgetNodeCode: '6.111',
  budgetNodeName: 'HAL Super App',
  departmentNodeId: 'd1',
  departmentNodeCode: 'RCU',
  departmentNodeName: 'Risk control',
  capAmount: null,
  tolerance: [{ at: 100, action }],
  isActive: true,
  available: '0',
  ceiling: '0',
  used: '0',
  governedBudgetIds: ['b1'],
});

describe('updateControlPointTolerance', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('replaces the edited row in place rather than reloading the list', async () => {
    // The list is filtered and paged. Reloading after an edit throws away the reader's position
    // for nothing: the response already carries the row's new state, derived figures included.
    const s = useBudgetsStore();
    s.controlPointList = [row('cp1', 'BLOCK'), row('cp2', 'BLOCK')] as never;
    s.page = 3;
    m.updateControlPoint.mockResolvedValueOnce(row('cp2', 'WARN'));

    await s.updateControlPointTolerance('cp2', [{ at: 100, action: 'WARN' }]);

    expect(m.updateControlPoint).toHaveBeenCalledWith('cp2', {
      tolerance: [{ at: 100, action: 'WARN' }],
    });
    expect(m.controlPointList).not.toHaveBeenCalled();
    expect(s.controlPointList.map((c) => c.tolerance[0].action)).toEqual(['BLOCK', 'WARN']);
    expect(s.page).toBe(3);
  });

  it('updates the open detail when it is the row that changed', async () => {
    const s = useBudgetsStore();
    s.controlPointList = [row('cp1', 'BLOCK')] as never;
    s.currentControlPoint = s.controlPointList[0];
    m.updateControlPoint.mockResolvedValueOnce(row('cp1', 'WARN'));

    await s.updateControlPointTolerance('cp1', [{ at: 100, action: 'WARN' }]);

    expect(s.currentControlPoint?.tolerance[0].action).toBe('WARN');
  });

  it('leaves an unrelated open detail alone', async () => {
    const s = useBudgetsStore();
    s.controlPointList = [row('cp1', 'BLOCK'), row('cp2', 'BLOCK')] as never;
    s.currentControlPoint = s.controlPointList[0];
    m.updateControlPoint.mockResolvedValueOnce(row('cp2', 'WARN'));

    await s.updateControlPointTolerance('cp2', [{ at: 100, action: 'WARN' }]);

    expect(s.currentControlPoint?.id).toBe('cp1');
    expect(s.currentControlPoint?.tolerance[0].action).toBe('BLOCK');
  });

  it('rethrows and leaves state unchanged when the server refuses', async () => {
    // The dialog stays open with the entered rungs, so the refusal has to reach it.
    const s = useBudgetsStore();
    s.controlPointList = [row('cp1', 'BLOCK')] as never;
    m.updateControlPoint.mockRejectedValueOnce({
      response: { data: { message: 'tolerance ladder must be a non-empty array' } },
    });

    await expect(
      s.updateControlPointTolerance('cp1', [{ at: 100, action: 'WARN' }]),
    ).rejects.toBeTruthy();

    expect(s.controlPointList[0].tolerance[0].action).toBe('BLOCK');
    expect(s.error).toContain('non-empty');
  });

  it('sends the rungs in the order they were entered', async () => {
    // Every matched rung applies and a matched BLOCK beats a matched WARN, so order carries no
    // meaning to the server — which is exactly why the client must not invent one. A reordered
    // ladder is a saved configuration that differs from the reviewed one.
    const s = useBudgetsStore();
    s.controlPointList = [row('cp1', 'BLOCK')] as never;
    m.updateControlPoint.mockResolvedValueOnce(row('cp1', 'BLOCK'));

    const entered = [
      { at: 100, action: 'BLOCK' as const },
      { at: 90, action: 'WARN' as const },
    ];
    await s.updateControlPointTolerance('cp1', entered);

    expect(m.updateControlPoint.mock.calls[0][1]).toEqual({ tolerance: entered });
  });
});
