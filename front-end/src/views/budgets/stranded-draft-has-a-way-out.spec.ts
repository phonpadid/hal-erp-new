import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../../i18n';
import { can } from '../../directives/can';
import { useAuthStore } from '../../stores/auth';

/**
 * A `DRAFT` budget that no plan carries: money that exists, cannot be spent, and — until this —
 * could not be got rid of or proposed again.
 *
 * The dimension index `budget_dimension_unique_unless_rejected` refuses a second proposal for the
 * same line, a budget has no delete (they are financial records), `REJECTED` is the one status
 * that frees the dimension and the edit form does not offer it, and `createPlan` had exactly one
 * caller — the create form. The only exits were SQL, or the call that was in fact made by hand to
 * recover budget `1.106`.
 *
 * Atomic intake makes the state unreachable going forward. These pin the exit for the rows that
 * predate it, and the distinction the screen has to draw: a draft AWAITING an approver and a draft
 * that lost its plan are the same status, and only one of them has anything a reader can do.
 */
const listMock = vi.fn();
const getMock = vi.fn();
const planForBudgetMock = vi.fn();
const reproposeMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      list: (...a: unknown[]) => listMock(...a),
      get: (...a: unknown[]) => getMock(...a),
      breakdown: vi.fn().mockResolvedValue({
        amountTotal: '12000000', adjustIncrease: '0', adjustDecrease: '0',
        transferIn: '0', transferOut: '0', reserve: '0', release: '0',
        actual: '0', available: '12000000',
      }),
      controlPoints: vi.fn().mockResolvedValue([]),
      ledger: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
      controlPointList: vi.fn().mockResolvedValue([]),
      movementDocTypes: vi.fn().mockResolvedValue({ adjustIncrease: [], adjustDecrease: [], transfer: [] }),
      planForBudget: (...a: unknown[]) => planForBudgetMock(...a),
      repropose: (...a: unknown[]) => reproposeMock(...a),
    },
  };
});
vi.mock('../../api/org', () => ({
  orgApi: {
    fiscalYears: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 }) },
    departments: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 }) },
  },
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

const BASE = {
  node: { id: 'n-1', code: '1.106', name: 'Support' },
  budgetName: 'Support and subsidies',
  amountTotal: '12000000',
  available: '12000000',
  fiscalYear: { year: 2026, company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } },
  department: { name: 'ADMIN' },
};
const STRANDED = { ...BASE, id: 'b-stranded', status: 'DRAFT', stranded: true };
const AWAITING = { ...BASE, id: 'b-awaiting', status: 'DRAFT', stranded: false };

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

beforeEach(() => {
  listMock.mockReset();
  getMock.mockReset();
  planForBudgetMock.mockReset();
  reproposeMock.mockReset();
  listMock.mockResolvedValue({ items: [STRANDED, AWAITING], total: 2, page: 1, limit: 20 });
});

describe('the budget list offers a way out of a stranded draft', () => {
  it('offers it on the draft no plan carries', async () => {
    const { w } = await mountView('/budgets', './BudgetListView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
    expect(w.findAll('[data-testid="repropose"]')).toHaveLength(1);
  });

  it('does NOT offer it on a draft that is simply awaiting an approver', async () => {
    // Same status, different situation. Offering it here would be offering an action that fails,
    // and offering it nowhere would hide the only exit the other row has.
    listMock.mockResolvedValue({ items: [AWAITING], total: 1, page: 1, limit: 20 });
    const { w } = await mountView('/budgets', './BudgetListView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
    expect(w.find('[data-testid="repropose"]').exists()).toBe(false);
  });

  it('does not offer it to a reader who cannot manage budgets', async () => {
    // `v-can` hides rather than unmounts, so the assertion is on what the reader can SEE. Raising
    // a plan is budget administration; reading the list is not.
    const { w } = await mountView('/budgets', './BudgetListView.vue', ['BUDGET_VIEW']);
    const button = w.find('[data-testid="repropose"]');
    expect(button.exists() && (button.element as HTMLElement).style.display).toBe('none');
  });
});

describe("the budget's own page offers it too", () => {
  it('says nothing carries it, and offers to propose it', async () => {
    getMock.mockResolvedValue(STRANDED);
    planForBudgetMock.mockResolvedValue(null);

    const { w } = await mountView('/budgets/b-stranded', './BudgetDetailView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
    expect(w.text()).toContain(i18n.global.t('budgets.plan.stranded'));
    expect(w.find('[data-testid="repropose"]').exists()).toBe(true);
  });

  it('names the plan instead when one already carries it', async () => {
    getMock.mockResolvedValue(AWAITING);
    planForBudgetMock.mockResolvedValue({ id: 'doc-9', docNo: 'PLAN-0001', status: 'SUBMITTED' });

    const { w } = await mountView('/budgets/b-awaiting', './BudgetDetailView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
    expect(w.text()).toContain('PLAN-0001');
    expect(w.text()).not.toContain(i18n.global.t('budgets.plan.stranded'));
    expect(w.find('[data-testid="repropose"]').exists()).toBe(false);
  });

  it('routes to the new plan after proposing', async () => {
    getMock.mockResolvedValue(STRANDED);
    planForBudgetMock.mockResolvedValue(null);
    reproposeMock.mockResolvedValue({ documentId: 'doc-rescued' });

    const { w, router } = await mountView('/budgets/b-stranded', './BudgetDetailView.vue', ['BUDGET_VIEW', 'BUDGET_MANAGE']);
    await w.find('[data-testid="repropose"]').trigger('click');
    await flushPromises();

    expect(reproposeMock).toHaveBeenCalledWith('b-stranded');
    // To the PLAN: it is what the user has to submit next, and the budget's page still shows
    // nothing until it is approved.
    expect(router.currentRoute.value.path).toBe('/documents/doc-rescued');
  });
});
