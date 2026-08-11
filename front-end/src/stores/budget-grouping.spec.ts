import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { UNGOVERNED_GROUP, useBudgetsStore } from './budgets';
import type { BudgetSummary, ControlPointSummary } from '../api/budgets';

/**
 * Grouping the budget list by the control point that governs each budget.
 *
 * The rule that matters is the BINDING one: a budget governed by several points appears under the
 * one with the least available, because that is the ceiling that will refuse it first. Grouping
 * under the nearest point instead could show a category with plenty of room while a wider ceiling
 * is nearly exhausted — the exact confusion these screens exist to remove.
 */
const cp = (over: Partial<ControlPointSummary> & { id: string }): ControlPointSummary => ({
  fiscalYearId: 'fy1',
  accountNodeId: 'a', accountNodeCode: '61', accountNodeName: 'Admin',
  departmentNodeId: 'd', departmentNodeCode: 'HQ', departmentNodeName: 'Head office',
  capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' }], isActive: true,
  available: '0', ceiling: '0', used: '0', governedBudgetIds: [],
  ...over,
});

const budget = (id: string): BudgetSummary => ({
  id, glAccount: id, budgetName: id, amountTotal: '100', status: 'ACTIVE',
});

describe('budgets store grouping', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('groups budgets under the control point that governs them', () => {
    const s = useBudgetsStore();
    s.list = ['1.101', '1.102', '1.103'].map(budget);
    s.controlPointList = [cp({ id: 'cat', ceiling: '534000000', available: '46791500', governedBudgetIds: ['1.101', '1.102', '1.103'] })];

    const groups = s.groupedBudgets;
    expect(groups).toHaveLength(1);
    expect(groups[0].controlPoint?.id).toBe('cat');
    expect(groups[0].budgets.map((b) => b.id)).toEqual(['1.101', '1.102', '1.103']);
  });

  it('puts a budget governed by several points under the tightest one, once', () => {
    const s = useBudgetsStore();
    s.list = [budget('b1')];
    s.controlPointList = [
      cp({ id: 'wide', available: '500000', governedBudgetIds: ['b1'] }),
      cp({ id: 'tight', available: '10000', governedBudgetIds: ['b1'] }),
    ];

    const groups = s.groupedBudgets;
    expect(groups).toHaveLength(1);
    expect(groups[0].controlPoint?.id).toBe('tight');
    expect(groups.flatMap((g) => g.budgets).filter((b) => b.id === 'b1')).toHaveLength(1);
  });

  it('breaks ties deterministically so the list does not reshuffle between loads', () => {
    const s = useBudgetsStore();
    s.list = [budget('b1')];
    s.controlPointList = [
      cp({ id: 'zzz', available: '10000', governedBudgetIds: ['b1'] }),
      cp({ id: 'aaa', available: '10000', governedBudgetIds: ['b1'] }),
    ];
    expect(s.groupedBudgets[0].controlPoint?.id).toBe('aaa');
  });

  it('compares availability as a number only for ordering, including negatives', () => {
    const s = useBudgetsStore();
    s.list = [budget('b1')];
    s.controlPointList = [
      cp({ id: 'positive', available: '1', governedBudgetIds: ['b1'] }),
      cp({ id: 'overdrawn', available: '-5000', governedBudgetIds: ['b1'] }),
    ];
    expect(s.groupedBudgets[0].controlPoint?.id).toBe('overdrawn');
  });

  it('flags a budget no control point governs instead of hiding it', () => {
    const s = useBudgetsStore();
    s.list = [budget('covered'), budget('orphan')];
    s.controlPointList = [cp({ id: 'cat', governedBudgetIds: ['covered'] })];

    const groups = s.groupedBudgets;
    const bucket = groups.find((g) => g.key === UNGOVERNED_GROUP)!;
    expect(bucket).toBeDefined();
    expect(bucket.ungoverned).toBe(true);
    expect(bucket.controlPoint).toBeNull();
    expect(bucket.budgets.map((b) => b.id)).toEqual(['orphan']);
  });

  it('omits the ungoverned bucket entirely when every budget is covered', () => {
    const s = useBudgetsStore();
    s.list = [budget('b1')];
    s.controlPointList = [cp({ id: 'cat', governedBudgetIds: ['b1'] })];
    expect(s.groupedBudgets.some((g) => g.key === UNGOVERNED_GROUP)).toBe(false);
  });

  it('carries the group figures straight from the control point, not summed from children', () => {
    // Children on this page total 200; the group's ceiling covers budgets beyond the page too.
    const s = useBudgetsStore();
    s.list = [budget('1.101'), budget('1.102')];
    s.controlPointList = [
      cp({ id: 'cat', ceiling: '534000000', used: '487208500', available: '46791500', governedBudgetIds: ['1.101', '1.102', 'off-page'] }),
    ];
    const g = s.groupedBudgets[0];
    expect(g.controlPoint?.ceiling).toBe('534000000');
    expect(g.controlPoint?.available).toBe('46791500');
    expect(g.budgets).toHaveLength(2);
  });

  it('is empty when nothing is loaded', () => {
    expect(useBudgetsStore().groupedBudgets).toEqual([]);
  });
});
