import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../../i18n';
import { can } from '../../directives/can';
import { useAuthStore } from '../../stores/auth';

/**
 * Correcting which department owns a budget.
 *
 * The plan code and the fiscal year are the budget's identity and stay fixed on an edit. The
 * department is not: it is a fact about the organisation, and organisations reorganise. A budget
 * whose work moved and cannot say so leaves the plan permanently misreporting whose appropriation
 * it is, with no way back — budgets have no delete by design.
 */
const getMock = vi.fn();
const updateMock = vi.fn();
const selectableDepartmentsMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      get: (...a: unknown[]) => getMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
      selectableDepartments: (...a: unknown[]) => selectableDepartmentsMock(...a),
      selectableFiscalYears: vi.fn().mockResolvedValue([]),
      nodes: vi.fn().mockResolvedValue([]),
    },
  };
});
vi.mock('../../api/org', () => ({
  orgApi: {
    companies: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 }) },
    departments: { create: vi.fn() },
    fiscalYears: { create: vi.fn() },
  },
}));
vi.mock('../../stores/accounts', () => ({
  useAccountsStore: () => ({ loadSelectable: vi.fn().mockResolvedValue([]), selectable: [] }),
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

const ADMIN = { id: 'd-adm', name: 'Administration' };
const VEHICLES = { id: 'd-veh', name: 'Vehicles' };
const BUDGET = {
  id: 'b1',
  budgetName: 'Office supplies',
  glAccount: '',
  status: 'ACTIVE',
  amountTotal: '1000000',
  department: ADMIN,
  node: { id: 'n1', code: '1.101', name: 'Office supplies' },
  fiscalYear: { year: 2026, company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } },
};

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets', name: 'budgets', component: { template: '<div />' } },
      { path: '/budgets/new', name: 'budget-new', component: { template: '<div />' } },
      { path: '/budgets/:id/edit', name: 'budget-edit', component: { template: '<div />' } },
      { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
    ],
  });
}

async function openEdit() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = ['BUDGET_VIEW', 'BUDGET_MANAGE'];
  const router = makeRouter();
  router.push('/budgets/b1/edit');
  await router.isReady();
  const { default: View } = await import('./BudgetFormView.vue');
  const w = mount(View, {
    global: {
      plugins: [i18n, PrimeVue, ToastService, ConfirmationService, router, pinia],
      directives: { can, tooltip: Tooltip },
      stubs: { teleport: true },
    },
  });
  await flushPromises();
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue(BUDGET);
  updateMock.mockResolvedValue(BUDGET);
  selectableDepartmentsMock.mockResolvedValue([ADMIN, VEHICLES]);
});

describe('the budget form can correct the owning department', () => {
  it('loads the departments on an edit, not only on a create', async () => {
    // They used to be read in the create branch alone, so the picker this test is about would have
    // rendered with nothing in it.
    await openEdit();
    expect(selectableDepartmentsMock).toHaveBeenCalled();
  });

  it('offers the department the budget currently belongs to as its starting value', async () => {
    // Seeded from the budget, so re-saving an untouched form is not a move — the server treats an
    // unchanged department as no move at all, and it cannot do that if the field arrives empty.
    const w = await openEdit();
    expect((w.vm as any).initialValues.departmentId).toBe('d-adm');
  });

  it('does not offer the fiscal year, which is identity and stays fixed', async () => {
    const w = await openEdit();
    const html = w.html();
    expect(html).toContain('Department');
    expect(html).not.toContain('Fiscal year');
  });

  it('says what a move carries with it', async () => {
    // The consequence is invisible otherwise: the spending history travels with the budget, and a
    // control point may be created for the destination. Both are things a budget officer would
    // want to know BEFORE choosing, not discover afterwards.
    const w = await openEdit();
    expect(w.text()).toContain('spending history');
    expect(w.text()).toContain('control point');
  });
});
