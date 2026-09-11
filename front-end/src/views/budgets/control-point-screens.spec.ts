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
 * The two screens that give the control point somewhere to live.
 *
 * The case they exist for is the one from the customer's 2026 sheet: a line 138,208,500 below its
 * own amount while the category governing it still has 46,791,500. Both numbers are correct; before
 * these screens only the negative one was reachable.
 */
const CP = {
  id: 'cp-cat',
  fiscalYearId: 'fy1',
  budgetNodeId: 'a1', budgetNodeCode: '1.100', budgetNodeName: 'General admin',
  departmentNodeId: 'd1', departmentNodeCode: 'ADMIN', departmentNodeName: 'Administration',
  capAmount: null,
  tolerance: [{ at: 90, action: 'WARN' as const }, { at: 100, action: 'BLOCK' as const }],
  isActive: true,
  ceiling: '534000000', used: '487208500', available: '46791500',
  governedBudgetIds: ['b-104', 'b-101'],
};

const BUDGETS = [
  { id: 'b-104', glAccount: '1.104', budgetName: 'Drinking water', amountTotal: '24000000', status: 'ACTIVE', available: '-138208500', fiscalYear: { company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } } },
  { id: 'b-101', glAccount: '1.101', budgetName: 'Office supplies', amountTotal: '350000000', status: 'ACTIVE', available: '50000000', fiscalYear: { company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } } },
];

const controlPointListMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      list: vi.fn().mockResolvedValue({ items: BUDGETS, total: BUDGETS.length, page: 1, limit: 20 }),
      controlPointList: (...args: unknown[]) => controlPointListMock(...args),
      controlPointBalance: vi.fn().mockResolvedValue({
        amountTotal: '534000000', adjustIncrease: '0', adjustDecrease: '0', transferIn: '0',
        transferOut: '0', reserved: '487208500', actual: '0', released: '0',
        available: '46791500', governedBudgetCount: 2,
      }),
    },
  };
});

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets', name: 'budgets', component: { template: '<div />' } },
      { path: '/budgets/control-points', name: 'control-points', component: { template: '<div />' } },
      { path: '/budgets/control-points/:id', name: 'control-point-detail', component: { template: '<div />' } },
      { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
    ],
  });
}

async function mountView(file: string, path: string, permissions: string[]) {
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
  return w;
}

describe('control point screens', () => {
  beforeEach(() => {
    controlPointListMock.mockReset();
    controlPointListMock.mockResolvedValue([CP]);
  });

  describe('list', () => {
    it('shows each point with the figures a ceiling needs', async () => {
      const w = await mountView('./ControlPointListView.vue', '/budgets/control-points', ['BUDGET_VIEW']);
      const text = w.text();
      expect(text).toContain('1.100');
      expect(text).toContain('General admin');
      expect(text).toContain('ADMIN');
      // ceiling and available, formatted to 0 decimals (LAK), never a hardcoded 2
      expect(text).toContain('534,000,000');
      expect(text).toContain('46,791,500');
      expect(text).not.toContain('534,000,000.00');
    });

    it('shows how many budgets each point governs', async () => {
      const w = await mountView('./ControlPointListView.vue', '/budgets/control-points', ['BUDGET_VIEW']);
      expect(w.text()).toContain('2');
    });

    it('renders the tolerance ladder', async () => {
      const w = await mountView('./ControlPointListView.vue', '/budgets/control-points', ['BUDGET_VIEW']);
      expect(w.text()).toMatch(/90%/);
      expect(w.text()).toMatch(/100%/);
    });

    it('asks the server for the default fiscal year rather than naming one', async () => {
      // The year covering today is resolved server-side; the screen must not invent a filter.
      await mountView('./ControlPointListView.vue', '/budgets/control-points', ['BUDGET_VIEW']);
      expect(controlPointListMock).toHaveBeenCalledWith(undefined);
    });

    it('says so loudly when a fiscal year has no control points', async () => {
      controlPointListMock.mockResolvedValue([]);
      const w = await mountView('./ControlPointListView.vue', '/budgets/control-points', ['BUDGET_VIEW']);
      expect(w.findComponent({ name: 'EmptyState' }).exists()).toBe(true);
    });
  });

  describe('detail', () => {
    it('reconciles the breakdown to the available amount', async () => {
      const w = await mountView('./ControlPointDetailView.vue', '/budgets/control-points/cp-cat', ['BUDGET_VIEW']);
      const text = w.text();
      expect(text).toContain('534,000,000');
      expect(text).toContain('487,208,500');
      expect(text).toContain('46,791,500');
    });

    it('lists the governed budgets with their own available', async () => {
      const w = await mountView('./ControlPointDetailView.vue', '/budgets/control-points/cp-cat', ['BUDGET_VIEW']);
      const text = w.text();
      expect(text).toContain('Drinking water');
      expect(text).toContain('Office supplies');
      // The whole point: a child far below zero under a ceiling that still holds.
      expect(text).toContain('-138,208,500');
    });

    it('marks an overdrawn child distinctly', async () => {
      const w = await mountView('./ControlPointDetailView.vue', '/budgets/control-points/cp-cat', ['BUDGET_VIEW']);
      const overdrawn = w.findAll('span').filter((s) => s.text().includes('-138,208,500'));
      expect(overdrawn.some((s) => s.classes().some((c) => c.includes('red')))).toBe(true);
    });

    it('renders both rungs of the ladder', async () => {
      const w = await mountView('./ControlPointDetailView.vue', '/budgets/control-points/cp-cat', ['BUDGET_VIEW']);
      const text = w.text();
      expect(text).toContain('90%');
      expect(text).toContain('100%');
    });
  });

  describe('the ladder editor is offered only to whoever may save it', () => {
    // `v-can` HIDES rather than unmounts, so "not offered" is a display check, not an existence
    // one — asserting existence here would pass against a button every reader can click.
    const editors = (w: { findAll: (s: string) => Array<{ element: Element }> }) =>
      w
        .findAll('[data-testid="edit-ladder"]')
        .filter((n) => (n.element as HTMLElement).style.display !== 'none');

    it('offers it on the detail to a BUDGET_MANAGE holder', async () => {
      const w = await mountView('./ControlPointDetailView.vue', '/budgets/control-points/cp-cat', [
        'BUDGET_VIEW',
        'BUDGET_MANAGE',
      ]);
      expect(editors(w)).toHaveLength(1);
    });

    it('withholds it on the detail from a BUDGET_VIEW-only reader', async () => {
      // The ladder itself still shows — reading the rule that governs your spending is a
      // BUDGET_VIEW thing. Only the control that would answer 403 is withheld.
      const w = await mountView('./ControlPointDetailView.vue', '/budgets/control-points/cp-cat', ['BUDGET_VIEW']);
      expect(w.text()).toContain('90');
      expect(editors(w)).toHaveLength(0);
    });

    it('offers it per row on the list to a BUDGET_MANAGE holder', async () => {
      const w = await mountView('./ControlPointListView.vue', '/budgets/control-points', [
        'BUDGET_VIEW',
        'BUDGET_MANAGE',
      ]);
      expect(editors(w)).toHaveLength(1);
    });

    it('withholds it on the list from a BUDGET_VIEW-only reader', async () => {
      const w = await mountView('./ControlPointListView.vue', '/budgets/control-points', ['BUDGET_VIEW']);
      expect(editors(w)).toHaveLength(0);
    });
  });
});
