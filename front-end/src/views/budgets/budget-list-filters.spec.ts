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
import { useBudgetsStore } from '../../stores/budgets';

/**
 * The two filters on the budget list, and the count that says what they are hiding.
 *
 * The list pages on the server, so what these assert is that the CONTROLS reach the query: the
 * screen's job is to send the reader's choice and reset to page 1, and the server's job — proved
 * in `back/src/modules/budget/budget-list-filters.spec.ts` — is to narrow.
 */
const CURRENCY = { company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } };
const BUDGETS = [
  { id: 'b-1', node: { id: 'n-1', code: '1.101' }, budgetName: 'Office supplies', amountTotal: '100', status: 'ACTIVE', available: '100', fiscalYear: CURRENCY, department: { id: 'd-fin', name: 'Finance' } },
];
const DEPARTMENTS = [
  { id: 'd-fin', deptCode: 'FIN', name: 'Finance' },
  { id: 'd-mkt', deptCode: 'MKT', name: 'Marketing' },
];

const listMock = vi.fn();
const filterDepartmentsMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      list: (...args: unknown[]) => listMock(...args),
      filterDepartments: (...args: unknown[]) => filterDepartmentsMock(...args),
      nodes: vi.fn().mockResolvedValue([]),
      controlPointList: vi.fn().mockResolvedValue([]),
    },
  };
});

async function mountList() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = ['BUDGET_VIEW'];
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets', name: 'budgets', component: { template: '<div />' } },
      { path: '/budgets/new', name: 'budget-new', component: { template: '<div />' } },
      { path: '/budgets/control-points/:id', name: 'control-point-detail', component: { template: '<div />' } },
      { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
    ],
  });
  router.push('/budgets');
  await router.isReady();
  const { default: View } = await import('./BudgetListView.vue');
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

/** The narrowing object the store sent on the most recent list call. */
const lastNarrowing = () => listMock.mock.calls.at(-1)?.[2] as Record<string, unknown> | undefined;

describe('budget list filters', () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue({ items: BUDGETS, total: 496, page: 1, limit: 20 });
    filterDepartmentsMock.mockReset();
    filterDepartmentsMock.mockResolvedValue(DEPARTMENTS);
  });

  it('asks for the department options on mount, once', async () => {
    await mountList();
    expect(filterDepartmentsMock).toHaveBeenCalledTimes(1);
  });

  it('renders two filter controls beside the search box', async () => {
    const w = await mountList();
    // PrimeVue renders a Select's options into a lazy overlay, so what is assertable without
    // opening one is that the controls exist and are labelled — which is the part a reader needs.
    const labels = w.findAll('[aria-label]').map((el) => el.attributes('aria-label'));
    expect(labels).toContain('ພະແນກ');
    expect(labels).toContain('ສະຖານະ');
  });

  it('takes its department options from the BUDGET_VIEW-gated read', async () => {
    await mountList();
    // Not `GET /departments`, which needs DEPARTMENT_VIEW a budget reader need not hold. The
    // options arrive already narrowed to departments that hold a budget.
    const budgets = useBudgetsStore();
    expect(filterDepartmentsMock).toHaveBeenCalled();
    expect(budgets.filterDepartments.map((d) => d.deptCode)).toEqual(['FIN', 'MKT']);
  });

  it('sends the department to the server and returns to page 1', async () => {
    await mountList();
    const budgets = useBudgetsStore();
    // Pretend the reader was on a later page before choosing a department.
    budgets.page = 12;
    listMock.mockClear();
    await budgets.narrow({ departmentId: 'd-mkt' });

    expect(listMock).toHaveBeenCalledTimes(1);
    // Page 1: the narrowing changes which budgets exist, so the old offset means nothing, and
    // landing on an empty page 12 reads as "no results" when the results are simply earlier.
    expect(listMock.mock.calls[0][0]).toBe(1);
    expect(lastNarrowing()).toMatchObject({ departmentId: 'd-mkt' });
  });

  it('sends the status to the server', async () => {
    await mountList();
    const budgets = useBudgetsStore();
    listMock.mockClear();
    await budgets.narrow({ status: 'REJECTED' });
    expect(lastNarrowing()).toMatchObject({ status: 'REJECTED' });
  });

  it('sends both filters and a term together', async () => {
    await mountList();
    const budgets = useBudgetsStore();
    listMock.mockClear();
    await budgets.narrow({ departmentId: 'd-fin', status: 'ACTIVE', search: 'fuel' });
    expect(lastNarrowing()).toMatchObject({ departmentId: 'd-fin', status: 'ACTIVE', search: 'fuel' });
  });

  it('keeps the narrowing when the reader pages', async () => {
    await mountList();
    const budgets = useBudgetsStore();
    await budgets.narrow({ departmentId: 'd-fin' });
    listMock.mockClear();
    await budgets.loadList(3, 20);
    // Page 3 of a filtered list is page 3 of that same filter, not of everything.
    expect(listMock.mock.calls[0][0]).toBe(3);
    expect(lastNarrowing()).toMatchObject({ departmentId: 'd-fin' });
  });

  it('sends no filter key when nothing is narrowed', async () => {
    await mountList();
    // An endpoint must not receive `status: ''`. Absent means "every status", which is the
    // deliberate default — filtering to ACTIVE by default would hide refused proposals silently.
    expect(lastNarrowing()).toEqual({ search: undefined, departmentId: undefined, status: undefined });
  });

  it('a failed options load leaves the list readable', async () => {
    filterDepartmentsMock.mockRejectedValue(new Error('boom'));
    const w = await mountList();
    const budgets = useBudgetsStore();
    // The store's `error` is what the screen renders an ErrorState for INSTEAD of the table, so a
    // dropdown that could not load must not touch it. The filter is unusable; the list is not.
    expect(budgets.error).toBe('');
    expect(budgets.filterDepartments).toEqual([]);
    expect(w.find('table').exists()).toBe(true);
  });

  it('says nothing about counts while the list is whole', async () => {
    const w = await mountList();
    // A count beside an unfiltered list is noise. Asserted in Lao because that is the default
    // locale this app renders in, and the string a reader actually meets.
    expect(w.text()).not.toContain('ສະແດງ');
  });

  it('states what a filter is hiding, against the unnarrowed total', async () => {
    const w = await mountList();
    const budgets = useBudgetsStore();
    expect(budgets.totalUnfiltered).toBe(496);

    listMock.mockResolvedValue({ items: BUDGETS, total: 59, page: 1, limit: 20 });
    await budgets.narrow({ departmentId: 'd-mkt' });
    await flushPromises();

    expect(w.text()).toContain('ສະແດງ 59 ຈາກ 496');
  });

  it('does not let a narrowed load overwrite the unnarrowed total', async () => {
    await mountList();
    const budgets = useBudgetsStore();
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    await budgets.narrow({ status: 'CLOSED' });
    // Otherwise the count would read "0 of 0" and say nothing at all.
    expect(budgets.totalUnfiltered).toBe(496);
  });

  it('clearing the narrowing reloads the whole list and refreshes the total', async () => {
    await mountList();
    const budgets = useBudgetsStore();
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    await budgets.narrow({ status: 'CLOSED' });

    listMock.mockResolvedValue({ items: BUDGETS, total: 500, page: 1, limit: 20 });
    await budgets.clearNarrowing();
    expect(budgets.narrowing).toBe(false);
    expect(budgets.totalUnfiltered).toBe(500);
    expect(lastNarrowing()).toEqual({ search: undefined, departmentId: undefined, status: undefined });
  });

  it('distinguishes an over-filtered list from an empty one', async () => {
    const w = await mountList();
    const budgets = useBudgetsStore();
    listMock.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    await budgets.narrow({ status: 'CLOSED' });
    await flushPromises();
    // "No budget matches what you are filtering by" — not "No budgets for this company", which
    // would tell a reader their data is missing.
    expect(w.text()).toContain('ບໍ່ມີງົບປະມານທີ່ກົງກັບເງື່ອນໄຂທີ່ທ່ານກັ່ນຕອງ');
    expect(w.text()).not.toContain('ບໍ່ມີງົບປະມານສຳລັບບໍລິສັດນີ້');
    // And the way out is offered, not just described.
    expect(w.text()).toContain('ລ້າງການກັ່ນຕອງ');
  });
});
