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
 * A plan line the organisation spends against but never funded is a real budget whose figure is
 * nothing. The 2026 expenditure plan holds 92 of them — 28,059,942,137 LAK already spent against
 * codes whose annual cell is empty — and the form refused every one of them, because the shared
 * resolver demanded a positive number while the server accepted `"0"` all along.
 *
 * Zero is now accepted AND announced: the budget is created, and every document charging it is
 * refused until someone loosens the tolerance ladder on the control point governing it — on a
 * different screen this form otherwise never mentions.
 */
const proposeMock = vi.fn();
const createNodeMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      selectableFiscalYears: vi
        .fn()
        .mockResolvedValue([{ id: 'fy1', year: 2026, status: 'OPEN', startDate: '2026-01-01', endDate: '2026-12-31' }]),
      selectableDepartments: vi.fn().mockResolvedValue([{ id: 'd1', deptCode: 'RCU', name: 'Risk control' }]),
      nodes: vi
        .fn()
        .mockResolvedValue([
          { id: 'n1', code: '6.111', name: 'HAL Super App', fiscalYearId: 'fy1', budgetCount: 0, childCount: 0 },
        ]),
      propose: (...a: unknown[]) => proposeMock(...a),
      createNode: (...a: unknown[]) => createNodeMock(...a),
    },
  };
});
vi.mock('../../api/org', () => ({
  orgApi: {
    fiscalYears: { list: vi.fn(), create: vi.fn() },
    departments: { list: vi.fn(), create: vi.fn() },
    companies: { list: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock('../../api/accounts', () => ({
  accountsApi: { selectable: vi.fn().mockResolvedValue([]) },
}));

beforeAll(() => {
  i18n.global.locale.value = 'en';
});
afterAll(() => {
  i18n.global.locale.value = 'la';
});

const BUDGET_OFFICER = ['BUDGET_MANAGE', 'BUDGET_VIEW', 'DOC_VIEW'];

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets', name: 'budgets', component: { template: '<div />' } },
      { path: '/budgets/new', name: 'budget-new', component: { template: '<div />' } },
      { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
      { path: '/documents/:id', name: 'document-detail', component: { template: '<div />' } },
    ],
  });
}

async function openCreateForm() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = BUDGET_OFFICER;
  const router = makeRouter();
  router.push('/budgets/new');
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

/** Type into the amount box the way a person does — the field is uncontrolled, so this is the
 *  only thing the notice can react to. */
async function typeAmount(w: Awaited<ReturnType<typeof openCreateForm>>, text: string) {
  const input = w.findAll('input').find((i) => i.attributes('inputmode') === 'decimal');
  expect(input, 'the amount field is rendered').toBeTruthy();
  input!.element.value = text;
  await input!.trigger('input');
  await flushPromises();
  return input!;
}

const notice = (w: Awaited<ReturnType<typeof openCreateForm>>) =>
  w.find('[data-testid="zero-amount-notice"]');

beforeEach(() => {
  vi.clearAllMocks();
  proposeMock.mockResolvedValue({ documentId: 'doc1', budgetId: 'b1' });
});

describe('the budget form accepts an unfunded line', () => {
  it('shows the zero notice when the amount is zero', async () => {
    // This also proves the RESOLVER accepted zero, which is the change's whole point: the notice
    // renders in the `v-else` of the field-error branch, so a resolver still refusing `0` would
    // mark the field invalid and this element would not exist.
    const w = await openCreateForm();
    await typeAmount(w, '0');
    expect(notice(w).exists()).toBe(true);
    expect(notice(w).text()).toMatch(/refused/i);
  });

  it('does not show the notice for a real appropriation', async () => {
    const w = await openCreateForm();
    await typeAmount(w, '23056000');
    expect(notice(w).exists()).toBe(false);
  });

  it('does not show the notice before anything is typed', async () => {
    const w = await openCreateForm();
    expect(notice(w).exists()).toBe(false);
  });

  it('keeps the notice out of the way of a real error', async () => {
    // A negative amount is still refused, and the error wins the slot: guidance about zero on a
    // field that is invalid for another reason reads as the explanation of the refusal.
    const w = await openCreateForm();
    await typeAmount(w, '-1');
    expect(notice(w).exists()).toBe(false);
  });
});
