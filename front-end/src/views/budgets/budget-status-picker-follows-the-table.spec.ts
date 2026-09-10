import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import ToastService from 'primevue/toastservice';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../../i18n';
import { can } from '../../directives/can';
import { useAuthStore } from '../../stores/auth';

/**
 * The status picker offers what the server will accept, and nothing else.
 *
 * It used to offer ACTIVE, INACTIVE and CLOSED regardless of where the budget stood. That was
 * harmless only while `BudgetService.update` assigned whatever it was sent; now that the same
 * transition table refuses on the server, editing a REJECTED budget would present three options and
 * refuse all three — every choice in the control an error, discoverable only by submitting one.
 *
 * Both halves read `canTransitionBudget` from `@erp/shared`, so these tests are really pinning that
 * they cannot drift apart: a move added to the table appears here without this file changing, and a
 * move removed from it disappears from the control the same way.
 */
const getMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      get: (...a: unknown[]) => getMock(...a),
      selectableFiscalYears: vi.fn().mockResolvedValue([
        { id: 'fy1', year: 2026, status: 'OPEN', startDate: '2026-01-01', endDate: '2026-12-31' },
      ]),
      selectableDepartments: vi.fn().mockResolvedValue([{ id: 'd1', deptCode: 'ADM', name: 'Administration' }]),
      nodes: vi.fn().mockResolvedValue([
        { id: 'n1', code: '1.101', name: 'Office supplies', fiscalYearId: 'fy1', budgetCount: 0, childCount: 0 },
      ]),
    },
  };
});
vi.mock('../../api/accounts', () => ({
  accountsApi: { selectable: vi.fn().mockResolvedValue([{ id: 'a1', code: '5000', name: 'Office supplies' }]) },
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets', name: 'budgets', component: { template: '<div />' } },
      { path: '/budgets/new', name: 'budget-new', component: { template: '<div />' } },
      { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
      { path: '/budgets/:id/edit', name: 'budget-edit', component: { template: '<div />' } },
      { path: '/documents/:id', name: 'document-detail', component: { template: '<div />' } },
    ],
  });
}

/** Open the EDIT form on a budget standing in `status`. */
async function openEditForm(status: string) {
  getMock.mockResolvedValue({
    id: 'b-1',
    budgetName: 'Cleaning equipment',
    glAccount: '5000',
    status,
    amountTotal: '1000000',
    fiscalYear: { id: 'fy1', year: 2026, company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } },
    department: { id: 'd1', deptCode: 'ADM', name: 'Administration' },
    node: { id: 'n1', code: '1.101', name: 'Office supplies' },
  });
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = ['BUDGET_MANAGE', 'BUDGET_VIEW', 'COA_VIEW'];
  const router = makeRouter();
  router.push('/budgets/b-1/edit');
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

/**
 * The values the status control offers. Found by the shape of its options rather than by position:
 * this form renders several `Select`s and the status one is the only whose values are all statuses.
 */
const STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'REJECTED', 'CLOSED'];
function statusChoices(w: Awaited<ReturnType<typeof openEditForm>>): string[] {
  for (const s of w.findAllComponents({ name: 'Select' })) {
    const opts = (s.props('options') ?? []) as Array<{ value?: unknown }>;
    const values = opts.map((o) => String(o.value));
    if (values.length && values.every((v) => STATUSES.includes(v))) return values;
  }
  return [];
}

beforeEach(() => vi.clearAllMocks());

describe('the budget status picker offers only what the server accepts', () => {
  it('lets money in force be suspended or closed', async () => {
    expect(statusChoices(await openEditForm('ACTIVE')).sort()).toEqual(['ACTIVE', 'CLOSED', 'INACTIVE']);
  });

  it('lets suspended money be restored or closed', async () => {
    expect(statusChoices(await openEditForm('INACTIVE')).sort()).toEqual(['ACTIVE', 'CLOSED', 'INACTIVE']);
  });

  /**
   * The case the fixed picker exists for. A rejected line is proposed again through a plan; it is
   * not edited back into force, and the control must not suggest it can be.
   */
  it('offers a rejected budget no way out, only the status it holds', async () => {
    expect(statusChoices(await openEditForm('REJECTED'))).toEqual(['REJECTED']);
  });

  it('offers a closed budget no way back', async () => {
    expect(statusChoices(await openEditForm('CLOSED'))).toEqual(['CLOSED']);
  });

  /**
   * DRAFT leaves through approval — `activate` on the plan's post-action — so the picker offers no
   * move at all. It still offers DRAFT itself, which is what keeps the rest of the form usable: the
   * name and the GL account of a proposed line can be corrected while it waits.
   */
  it('offers a draft budget nothing by hand, and still lets the form save', async () => {
    expect(statusChoices(await openEditForm('DRAFT'))).toEqual(['DRAFT']);
  });
});
