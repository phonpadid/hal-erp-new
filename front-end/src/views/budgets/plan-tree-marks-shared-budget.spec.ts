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
 * Marking a place in the plan as carrying money the whole company draws on.
 *
 * The tree is the only screen that renders the plan as a hierarchy, which is why the mark is made
 * here: what a mark covers — the whole subtree beneath it — is visible at the moment it is decided.
 * A mark on a department root shares that department's entire plan; a mark on one category shares
 * only that category, and nothing on screen distinguishes the two unless it is said.
 */
const nodesMock = vi.fn();
const updateNodeMock = vi.fn();
const listMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      list: (...a: unknown[]) => listMock(...a),
      nodes: (...a: unknown[]) => nodesMock(...a),
      updateNode: (...a: unknown[]) => updateNodeMock(...a),
      controlPointList: vi.fn().mockResolvedValue([]),
      // Mounting the view loads the filter's departments too. Unmocked it was a real request to
      // whatever `VITE_API_URL` names, and its reply — a 401 from the shared test server — logged
      // the app out mid-test and took this file's permissions with it.
      filterDepartments: vi.fn().mockResolvedValue([]),
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

const CUR = { year: 2026, company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } };

/** `1.400` is marked; `1.406` beneath it is shared through it; `1.200`/`1.201` are ADM's own. */
const NODES = [
  { id: 'n1', code: '1', name: 'Administration', fiscalYearId: 'fy1', budgetCount: 0, childCount: 2, isShared: false, sharedByAncestor: false },
  { id: 'n400', code: '1.400', name: 'Monthly recurring', parentId: 'n1', fiscalYearId: 'fy1', budgetCount: 0, childCount: 1, isShared: true, sharedByAncestor: false },
  { id: 'n406', code: '1.406', name: 'Phone bills', parentId: 'n400', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0, isShared: false, sharedByAncestor: true },
  { id: 'n200', code: '1.200', name: 'Licences', parentId: 'n1', fiscalYearId: 'fy1', budgetCount: 0, childCount: 1, isShared: false, sharedByAncestor: false },
  { id: 'n201', code: '1.201', name: 'Postal licence', parentId: 'n200', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0, isShared: false, sharedByAncestor: false },
];
const BUDGETS = [
  { id: 'b406', node: { id: 'n406', code: '1.406' }, budgetName: 'Phone bills', amountTotal: '1000000', available: '1000000', status: 'ACTIVE', fiscalYear: CUR },
  { id: 'b201', node: { id: 'n201', code: '1.201' }, budgetName: 'Postal licence', amountTotal: '2000000', available: '2000000', status: 'ACTIVE', fiscalYear: CUR },
];

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets', name: 'budgets', component: { template: '<div />' } },
      { path: '/budgets/new', name: 'budget-new', component: { template: '<div />' } },
      { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
      { path: '/budgets/control-points/:id', name: 'control-point-detail', component: { template: '<div />' } },
      { path: '/documents/:id', name: 'document-detail', component: { template: '<div />' } },
    ],
  });
}

async function openTree(permissions: string[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = permissions;
  const router = makeRouter();
  router.push('/budgets');
  await router.isReady();
  const { default: View } = await import('./BudgetListView.vue');
  const w = mount(View, {
    global: {
      plugins: [i18n, PrimeVue, ToastService, ConfirmationService, router, pinia],
      directives: { can, tooltip: Tooltip },
      stubs: { teleport: true },
    },
  });
  await flushPromises();
  // The tree column only exists in tree mode — the list defaults to its grouped presentation.
  const { useBudgetsStore } = await import('../../stores/budgets');
  const store = useBudgetsStore();
  store.listMode = 'tree';
  await store.loadTree();
  await flushPromises();
  // PrimeVue paints the TreeTable body on its own tick, which `flushPromises` does not wait for:
  // on an unloaded machine the control is there by the time it returns, on a loaded CI runner it is
  // not, and the queries below then read a table that has not finished rendering. This failed in CI
  // and never locally, twice — the first attempt waited for `tbody tr`, which the empty-message row
  // satisfies before a single data row exists.
  //
  // Waiting for the CONTROL itself is what every assertion here is actually about, and it is a
  // sound wait for the reader case too: `v-can` hides the button by setting `display: none`, it
  // never unmounts it, so the element exists for both permission sets and only its visibility
  // differs. Without this, "no visible button" is indistinguishable from "not rendered yet", and
  // the reader test would pass for the wrong reason.
  await vi.waitUntil(() => w.findAll('[data-testid="mark-shared"]').length > 0, {
    timeout: 2000,
    interval: 10,
  });
  return w;
}

beforeEach(() => {
  vi.clearAllMocks();
  nodesMock.mockResolvedValue(NODES);
  listMock.mockResolvedValue({ items: BUDGETS, total: 2, page: 1, limit: 500 });
  updateNodeMock.mockResolvedValue({});
});

describe('the plan tree marks a subtree as shared', () => {
  it('offers the mark to a BUDGET_MANAGE user', async () => {
    const w = await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    const visible = w.findAll('[data-testid="mark-shared"]')
      .filter((b) => (b.element as HTMLElement).style.display !== 'none');
    expect(visible.length).toBeGreaterThan(0);
  });

  it('does not offer it to a reader who may only view budgets', async () => {
    // `v-can` hides rather than unmounts, so this asks what the reader can SEE.
    const w = await openTree(['BUDGET_VIEW']);
    const visible = w.findAll('[data-testid="mark-shared"]')
      .filter((b) => (b.element as HTMLElement).style.display !== 'none');
    expect(visible).toHaveLength(0);
  });

  it('carries the inherited/marked distinction onto every tree row', async () => {
    // `1.406` is shared because `1.400` above it is marked. The column renders one as `shared` with
    // a control and the other as `sharedByAncestor` with none, because un-marking happens on the
    // ancestor and a control here would not do what it appears to.
    //
    // Asserted on the ROW DATA, not the rendered row: PrimeVue's TreeTable renders only the roots
    // until a reader expands it, and this harness cannot drive that toggle. What the column shows
    // for each case is covered by the two rendering tests above and below; what is pinned here is
    // that the distinction survives into the rows they render from.
    await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    const { useBudgetsStore } = await import('../../stores/budgets');

    const flat: Array<Record<string, unknown>> = [];
    const walk = (rows: Array<{ data: Record<string, unknown>; children?: never[] }>) => {
      for (const r of rows) {
        flat.push(r.data);
        if (r.children) walk(r.children);
      }
    };
    walk(useBudgetsStore().budgetTree as never);
    const by = (code: string) => flat.find((d) => d.code === code)!;

    expect(by('1.400')).toMatchObject({ isShared: true, sharedByAncestor: false });
    expect(by('1.406')).toMatchObject({ isShared: false, sharedByAncestor: true });
    expect(by('1.201')).toMatchObject({ isShared: false, sharedByAncestor: false });
    // Every markable row names the node the mark would land on — which for a collapsed
    // one-budget row is NOT the row's own id.
    expect(by('1.406').nodeId).toBe('n406');
  });

  it('sends the mark and reloads, because sharing is inherited', async () => {
    const w = await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    // Waited for rather than read once: `v-can` sets the button's visibility in its own `mounted`
    // hook, one tick after the row it lives in exists. Reading the list a single time turned that
    // ordering into `undefined.trigger` on a loaded runner, which names neither the control nor the
    // wait it needed.
    const button = await vi.waitUntil(
      () => w.findAll('[data-testid="mark-shared"]').find((b) => (b.element as HTMLElement).style.display !== 'none'),
      { timeout: 2000, interval: 10 },
    );
    await button.trigger('click');
    await flushPromises();

    expect(updateNodeMock).toHaveBeenCalledOnce();
    const [, body] = updateNodeMock.mock.calls[0];
    expect(body).toHaveProperty('isShared');
    // One mark changes `sharedByAncestor` on everything beneath it, so the tree is re-read rather
    // than patched in place.
    expect(nodesMock).toHaveBeenCalledTimes(2);
  });

  it('states how many budgets a mark would cover, counting the whole subtree', async () => {
    // Caught in the running app, not here: the first version showed the NODE's own budget count,
    // which is zero for every category — so marking `1.1`, and with it the twelve million at
    // `1.106` beneath it, advertised "covers 0 budgets". The reach of the decision has to be the
    // reach, or the sentence is worse than silence.
    const w = await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    const titles = w.findAll('[data-testid="mark-shared"]').map((b) => b.attributes('title') ?? '');
    expect(titles.some((t) => /Covers \d+ budget/.test(t))).toBe(true);
    // The root `1` has two budgets in its subtree (`1.406` and `1.201`), neither hanging off it.
    expect(titles.some((t) => t.includes('Covers 2 budget'))).toBe(true);
    expect(titles.every((t) => !t.includes('Covers 0 budget'))).toBe(true);
  });
});
