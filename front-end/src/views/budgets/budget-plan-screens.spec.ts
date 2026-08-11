import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { can } from '../../directives/can';
import { useAuthStore } from '../../stores/auth';

/**
 * The screens for a budget that is not in force yet.
 *
 * A budget is now DRAFT until the plan proposing it is approved, and DRAFT budgets are governed by
 * nothing on purpose. Two things follow, and neither is visible to a type check: the list must not
 * file them under "no control point governs these" (which is the red configuration-fault heading),
 * and the detail must not offer Adjust or Transfer on a budget that has no money to move.
 */
const CURRENCY = { company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } };

const ACTIVE_BUDGET = {
  id: 'b-1', glAccount: '1.101', budgetName: 'Office supplies',
  amountTotal: '350000000', status: 'ACTIVE', available: '50000000', fiscalYear: CURRENCY,
};
const DRAFT_BUDGET = {
  id: 'b-2', glAccount: '1.102', budgetName: 'Proposed stationery',
  amountTotal: '10000000', status: 'DRAFT', available: '10000000', fiscalYear: CURRENCY,
};
const CP = {
  id: 'cp-1', fiscalYearId: 'fy1',
  accountNodeId: 'a1', accountNodeCode: '1.100', accountNodeName: 'General admin',
  departmentNodeId: 'd1', departmentNodeCode: 'ADMIN', departmentNodeName: 'Administration',
  capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
  ceiling: '350000000', used: '300000000', available: '50000000',
  governedBudgetIds: ['b-1'],
};

const createMock = vi.fn();
const createPlanMock = vi.fn();
const planForBudgetMock = vi.fn();
const getMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      list: vi.fn().mockResolvedValue({
        items: [ACTIVE_BUDGET, DRAFT_BUDGET], total: 2, page: 1, limit: 20,
      }),
      controlPointList: vi.fn().mockResolvedValue([CP]),
      get: (...a: unknown[]) => getMock(...a),
      breakdown: vi.fn().mockResolvedValue({
        amountTotal: '10000000', adjustIncrease: '0', adjustDecrease: '0',
        transferIn: '0', transferOut: '0', reserve: '0', release: '0',
        actual: '0', available: '10000000',
      }),
      controlPoints: vi.fn().mockResolvedValue([]),
      ledger: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
      movementDocTypes: vi.fn().mockResolvedValue({ adjustIncrease: [], adjustDecrease: [], transfer: [] }),
      create: (...a: unknown[]) => createMock(...a),
      createPlan: (...a: unknown[]) => createPlanMock(...a),
      planForBudget: (...a: unknown[]) => planForBudgetMock(...a),
    },
  };
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets', name: 'budgets', component: { template: '<div />' } },
      { path: '/budgets/new', name: 'budget-new', component: { template: '<div />' } },
      { path: '/budgets/:id/edit', name: 'budget-edit', component: { template: '<div />' } },
      { path: '/budgets/control-points/:id', name: 'control-point-detail', component: { template: '<div />' } },
      { path: '/documents/:id', name: 'document-detail', component: { template: '<div />' } },
      { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
    ],
  });
}

async function mountView(path: string, file: string, permissions: string[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = permissions;
  const router = makeRouter();
  router.push(path);
  await router.isReady();
  const { default: View } = await import(/* @vite-ignore */ file);
  const w = mount(View, {
    global: {
      plugins: [i18n, PrimeVue, ToastService, ConfirmationService, router, pinia],
      directives: { can },
      stubs: { teleport: true },
    },
  });
  await flushPromises();
  return { w, router };
}

describe('budgets that are not in force', () => {
  beforeEach(() => {
    createMock.mockReset();
    createPlanMock.mockReset();
    planForBudgetMock.mockReset();
    getMock.mockReset();
  });

  describe('the list', () => {
    it('groups a DRAFT budget under its status, not under the configuration fault', async () => {
      const { w } = await mountView('/budgets', './BudgetListView.vue', ['BUDGET_VIEW']);
      const text = w.text();
      // Its own heading...
      expect(text).toContain(i18n.global.t('budgets.status.DRAFT'));
      expect(text).toContain(i18n.global.t('budgets.groups.notInForceHint'));
      // ...and NOT the red "no control point governs these" fault heading, which would report a
      // defect where the system is working as specified.
      expect(text).not.toContain(i18n.global.t('budgets.groups.ungoverned'));
    });

    it('gives the not-in-force group no ceiling or available figure', async () => {
      // No control point governs these and none is owed, so any figure here would be invented.
      const { w } = await mountView('/budgets', './BudgetListView.vue', ['BUDGET_VIEW']);
      const headers = w.findAll('tr.p-datatable-row-group-header');
      const pending = headers.find((h) => h.text().includes(i18n.global.t('budgets.groups.notInForceHint')));
      expect(pending).toBeDefined();
      expect(pending!.text()).not.toContain('%');
    });

    it('still shows the fault heading for an ACTIVE budget nothing governs', async () => {
      // The two must not collapse into one another: this one IS a defect.
      const pinia = createPinia();
      setActivePinia(pinia);
      const { useBudgetsStore } = await import('../../stores/budgets');
      const store = useBudgetsStore();
      store.list = [{ ...ACTIVE_BUDGET, id: 'b-orphan' } as never];
      store.controlPointList = [];
      const groups = store.groupedBudgets;
      expect(groups).toHaveLength(1);
      expect(groups[0].ungoverned).toBe(true);
    });
  });

  describe('the detail', () => {
    it('offers neither Adjust nor Transfer, and names the plan that proposed it', async () => {
      getMock.mockResolvedValue({ ...DRAFT_BUDGET, department: { name: 'ADMIN' } });
      planForBudgetMock.mockResolvedValue({ id: 'doc-9', docNo: 'PLAN-0001', status: 'SUBMITTED' });

      const { w } = await mountView('/budgets/b-2', './BudgetDetailView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      const text = w.text();
      expect(text).toContain('PLAN-0001');
      expect(text).toContain(i18n.global.t('budgets.plan.notInForce'));
      expect(text).not.toContain(i18n.global.t('budgets.adjust.button'));
      expect(text).not.toContain(i18n.global.t('budgets.transfer.button'));
    });

    it('offers them again once the budget is in force', async () => {
      getMock.mockResolvedValue({ ...ACTIVE_BUDGET, department: { name: 'ADMIN' } });

      const { w } = await mountView('/budgets/b-1', './BudgetDetailView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      const text = w.text();
      expect(text).toContain(i18n.global.t('budgets.adjust.button'));
      expect(text).toContain(i18n.global.t('budgets.transfer.button'));
      // An ACTIVE budget's plan is history — the ledger says where its money went.
      expect(planForBudgetMock).not.toHaveBeenCalled();
    });
  });

  describe('the create form', () => {
    it('says saving proposes rather than sets', async () => {
      const { w } = await mountView('/budgets/new', './BudgetFormView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
      expect(w.text()).toContain(i18n.global.t('budgets.plan.proposeNotice'));
    });

    it('drafts the budget, raises a plan for it, and routes to the plan', async () => {
      const pinia = createPinia();
      setActivePinia(pinia);
      const { useBudgetsStore } = await import('../../stores/budgets');
      createMock.mockResolvedValue({ id: 'b-new' });
      createPlanMock.mockResolvedValue({ documentId: 'doc-new' });

      const result = await useBudgetsStore().proposeBudget({
        fiscalYearId: 'fy1', departmentId: 'd1', glAccount: '5000', amountTotal: '1000',
      } as never);

      expect(createMock).toHaveBeenCalledOnce();
      expect(createPlanMock).toHaveBeenCalledWith({
        departmentId: 'd1',
        lines: [{ budgetId: 'b-new' }],
      });
      expect(result.documentId).toBe('doc-new');
    });
  });
});
