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
 * `LATTANAPHONE` is the company's budget officer. They hold `BUDGET_MANAGE`, the budgets list
 * offers them "New budget", the route guard lets them through — and the form could not be filled.
 *
 * It read its two required pickers from the organisation directory, which needs `FISCAL_YEAR_MANAGE`
 * and `DEPARTMENT_VIEW`. They hold neither, both answered 403, and because that `Promise.all` sat in
 * an `onMounted` with no `catch`, the rejection stopped everything after it: the node picker never
 * loaded and `initialValues` was never set. A form with every required field empty and no message.
 *
 * The permission set below is theirs, copied from the customer database. `admin` holds every code
 * and so could never reproduce any of this.
 */
const selectableFiscalYearsMock = vi.fn();
const selectableDepartmentsMock = vi.fn();
const nodesMock = vi.fn();
const fyListMock = vi.fn();
const deptListMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      selectableFiscalYears: (...a: unknown[]) => selectableFiscalYearsMock(...a),
      selectableDepartments: (...a: unknown[]) => selectableDepartmentsMock(...a),
      nodes: (...a: unknown[]) => nodesMock(...a),
    },
  };
});
vi.mock('../../api/org', () => ({
  orgApi: {
    // Kept as spies rather than removed: the assertion that the form NO LONGER touches the
    // directory is the point, and it can only be made against something observable.
    fiscalYears: { list: (...a: unknown[]) => fyListMock(...a), create: vi.fn() },
    departments: { list: (...a: unknown[]) => deptListMock(...a), create: vi.fn() },
    companies: { list: vi.fn().mockRejectedValue(new Error('403')) },
  },
}));
vi.mock('../../api/accounts', () => ({
  accountsApi: { selectable: vi.fn().mockResolvedValue([{ id: 'a1', code: '5000', name: 'Office supplies' }]) },
}));

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

/** LATTANAPHONE's actual grants: BUDGET_MANAGE, and no organisation permission at all. */
const BUDGET_OFFICER = [
  'BUDGET_MANAGE', 'BUDGET_VIEW', 'COA_VIEW', 'DOC_APPROVE', 'DOC_BACKDATE', 'DOC_CANCEL',
  'DOC_CREATE', 'DOC_RECEIVE', 'DOC_SUBMIT', 'DOC_VIEW', 'MASTER_VIEW', 'NOTIFICATION_VIEW',
  'QUOTA_VIEW', 'REPORT_VIEW',
];

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

async function openCreateForm(permissions: string[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = permissions;
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

/** Every `Select` the form rendered, with the options it was actually given. */
const optionCounts = (w: Awaited<ReturnType<typeof openCreateForm>>) =>
  w.findAllComponents({ name: 'Select' }).map((s) => (s.props('options') as unknown[] | undefined)?.length ?? 0);

beforeEach(() => {
  vi.clearAllMocks();
  selectableFiscalYearsMock.mockResolvedValue([
    { id: 'fy1', year: 2026, status: 'OPEN', startDate: '2026-01-01', endDate: '2026-12-31' },
  ]);
  selectableDepartmentsMock.mockResolvedValue([{ id: 'd1', deptCode: 'ADM', name: 'Administration' }]);
  nodesMock.mockResolvedValue([
    { id: 'n1', code: '1.101', name: 'Office supplies', fiscalYearId: 'fy1', budgetCount: 0, childCount: 0 },
  ]);
});

describe('the budget officer can fill in the form', () => {
  it('populates every required picker without any organisation permission', async () => {
    const w = await openCreateForm(BUDGET_OFFICER);
    // The regression, stated as the thing the user could not do: three populated pickers.
    expect(optionCounts(w).filter((n) => n > 0).length).toBeGreaterThanOrEqual(3);
  });

  it('does not touch the organisation directory at all', async () => {
    await openCreateForm(BUDGET_OFFICER);
    // The two reads that answered 403. If a later edit points the pickers back at them, this fails
    // here rather than in the browser of someone who cannot report what they are not seeing.
    expect(fyListMock).not.toHaveBeenCalled();
    expect(deptListMock).not.toHaveBeenCalled();
    expect(selectableFiscalYearsMock).toHaveBeenCalledOnce();
    expect(selectableDepartmentsMock).toHaveBeenCalledOnce();
  });

  it('loads the node picker, which the abandoned load never reached', async () => {
    // `nodes()` ran AFTER the rejected Promise.all, so it never ran at all. Its own gate
    // (DOC_CREATE) was fine; it was collateral damage.
    await openCreateForm(BUDGET_OFFICER);
    expect(nodesMock).toHaveBeenCalledOnce();
  });
});

describe('an organisation-creating action is offered only to whoever may perform it', () => {
  /** `v-can` hides rather than unmounts, so this asks what the user can SEE. */
  const visibleActions = (w: Awaited<ReturnType<typeof openCreateForm>>) =>
    w.findAll('button')
      .filter((b) => (b.element as HTMLElement).style.display !== 'none')
      .map((b) => b.attributes('aria-label'))
      .filter(Boolean);

  it('hides "new fiscal year" and "new department" from the budget officer', async () => {
    const w = await openCreateForm(BUDGET_OFFICER);
    const labels = visibleActions(w);
    expect(labels).not.toContain(i18n.global.t('admin.org.newFiscalYear'));
    expect(labels).not.toContain(i18n.global.t('admin.org.newDepartment'));
  });

  it('still offers "new plan node", which needs only BUDGET_MANAGE', async () => {
    const w = await openCreateForm(BUDGET_OFFICER);
    expect(visibleActions(w)).toContain(i18n.global.t('budgets.form.newNode'));
  });

  it('offers all three to an administrator who holds the organisation permissions', async () => {
    const w = await openCreateForm([...BUDGET_OFFICER, 'FISCAL_YEAR_MANAGE', 'DEPARTMENT_MANAGE']);
    const labels = visibleActions(w);
    expect(labels).toContain(i18n.global.t('admin.org.newFiscalYear'));
    expect(labels).toContain(i18n.global.t('admin.org.newDepartment'));
  });
});

describe('a form that cannot load says so', () => {
  it('shows the error and the reason instead of empty required pickers', async () => {
    // What a 403 used to produce: an abandoned load and a form indistinguishable from one nobody
    // had filled in. Shaped like a real Axios refusal, so the assertion is that the SERVER's reason
    // reaches the screen — not a generic "something failed" that tells the user nothing.
    selectableFiscalYearsMock.mockRejectedValue({
      response: { status: 403, data: { message: 'Missing required permission' } },
    });
    const w = await openCreateForm(BUDGET_OFFICER);

    expect(w.find('[data-testid="budget-form-load-error"]').exists()).toBe(true);
    expect(w.text()).toContain('Missing required permission');
    expect(optionCounts(w)).toHaveLength(0);
  });

  it('recovers on retry once the read succeeds', async () => {
    selectableFiscalYearsMock.mockRejectedValueOnce({ response: { data: { message: 'boom' } } });
    const w = await openCreateForm(BUDGET_OFFICER);
    expect(w.find('[data-testid="budget-form-load-error"]').exists()).toBe(true);

    await w.findComponent({ name: 'ErrorState' }).vm.$emit('retry');
    await flushPromises();

    expect(w.find('[data-testid="budget-form-load-error"]').exists()).toBe(false);
    expect(optionCounts(w).filter((n) => n > 0).length).toBeGreaterThanOrEqual(3);
  });
});
