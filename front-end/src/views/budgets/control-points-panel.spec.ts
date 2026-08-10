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
 * The governing-control-points panel on the budget detail.
 *
 * A budget's own available no longer decides whether a document charging it can be submitted, so
 * without this panel a user refused by an ancestor ceiling has no way to see why — and the usual
 * response to an unexplained refusal is to charge the spend to a different line, which destroys
 * the reporting the budget exists to produce.
 */
const CONTROL_POINTS = [
  {
    id: 'cp-wide',
    fiscalYearId: 'fy1',
    accountNodeId: 'a1', accountNodeCode: '61', accountNodeName: 'Admin',
    departmentNodeId: 'd1', departmentNodeCode: 'HQ', departmentNodeName: 'Head office',
    capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
    available: '10000',
  },
  {
    id: 'cp-own',
    fiscalYearId: 'fy1',
    accountNodeId: 'a2', accountNodeCode: '6110', accountNodeName: 'Supplies',
    departmentNodeId: 'd2', departmentNodeCode: 'PROC', departmentNodeName: 'Procurement',
    capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
    available: '5000000',
  },
];

const controlPointsMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      get: vi.fn().mockResolvedValue({
        id: 'b1', budgetName: 'Supplies', glAccount: '6110', status: 'ACTIVE', amountTotal: '5000000',
        fiscalYear: { company: { baseCurrency: { code: 'LAK', decimalPlaces: 2 } } },
      }),
      breakdown: vi.fn().mockResolvedValue({
        amountTotal: '5000000', adjustIncrease: '0', adjustDecrease: '0', transferIn: '0',
        transferOut: '0', reserved: '0', actual: '0', released: '0', available: '5000000',
      }),
      controlPoints: (...args: unknown[]) => controlPointsMock(...args),
      ledger: vi.fn().mockResolvedValue([]),
      movementDocTypes: vi.fn().mockResolvedValue({ adjustIncrease: [], adjustDecrease: [], transfer: [] }),
    },
  };
});

describe('BudgetDetailView governing control points', () => {
  beforeEach(() => {
    controlPointsMock.mockReset();
    controlPointsMock.mockResolvedValue(CONTROL_POINTS);
  });

  async function mountWith(permissions: string[]) {
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().permissions = permissions;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
        { path: '/budgets/:id/edit', name: 'budget-edit', component: { template: '<div />' } },
        { path: '/documents/:id', name: 'document-detail', component: { template: '<div />' } },
      ],
    });
    router.push('/budgets/b1');
    await router.isReady();
    const { default: BudgetDetailView } = await import('./BudgetDetailView.vue');
    const w = mount(BudgetDetailView, {
      global: {
        plugins: [i18n, PrimeVue, ToastService, ConfirmationService, router, pinia],
        directives: { can },
        stubs: { teleport: true },
      },
    });
    await flushPromises();
    return w;
  }

  it('lists every governing control point with its nodes', async () => {
    const w = await mountWith(['BUDGET_VIEW']);
    const text = w.text();
    expect(text).toContain('61');
    expect(text).toContain('Admin');
    expect(text).toContain('Head office');
    expect(text).toContain('Supplies');
    expect(text).toContain('Procurement');
  });

  it('marks the tightest control point as the one that refuses first', async () => {
    const w = await mountWith(['BUDGET_VIEW']);
    const tags = w.findAllComponents({ name: 'Tag' });
    const binding = tags.filter((t) => t.text().length > 0);
    expect(binding.length).toBeGreaterThan(0);
    // The 10,000 point binds, not the 5,000,000 one the budget itself shows.
    const rows = w.findAll('.border-b');
    const bindingRow = rows.find((r) => r.text().includes('Head office'));
    expect(bindingRow?.text()).toContain('10,000');
  });

  it('formats amounts to the currency decimal places, never as a JS number', async () => {
    const w = await mountWith(['BUDGET_VIEW']);
    expect(w.text()).toContain('10,000.00');
  });

  it('is hidden without BUDGET_VIEW', async () => {
    const w = await mountWith([]);
    expect(w.text()).not.toContain('Head office');
  });

  it('says so loudly when nothing governs the budget', async () => {
    // An uncovered budget is a configuration fault, not an unlimited budget — the panel must not
    // read as "no restrictions".
    controlPointsMock.mockResolvedValue([]);
    const w = await mountWith(['BUDGET_VIEW']);
    // The suite runs in the app's default locale (la), so assert the rendered string, not the key.
    expect(w.text()).toContain('ບໍ່ມີຈຸດຄວບຄຸມໃດຄຸ້ມຄອງງົບນີ້');
    expect(w.findComponent({ name: 'EmptyState' }).exists()).toBe(true);
  });
});
