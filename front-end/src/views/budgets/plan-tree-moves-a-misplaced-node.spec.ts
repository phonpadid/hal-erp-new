import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { can } from '../../directives/can';
import { useAuthStore } from '../../stores/auth';
import { createMemoryHistory, createRouter } from 'vue-router';

/**
 * Correcting a plan node that was entered in the wrong place.
 *
 * There is no other way out of the mistake, which is why the screen has to offer this one. A node
 * cannot be deleted and `(fiscal_year_id, code)` is unique forever, so the code of a line entered
 * wrongly is spent — and deactivating the BUDGET sitting at that node frees nothing, because only
 * the node holds the code. Re-entering the line is refused; moving the node that was made is the
 * whole of the fix.
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

/**
 * The customer's own shape, reduced: `7.701` was entered under `7.70` and belongs under `19.100`.
 * `7.701` holds one budget and no children, so the tree collapses it into a single row whose own
 * name is the BUDGET's — the case that decides where the dialog reads its values from.
 */
const NODES = [
  { id: 'n7', code: '7.70', name: 'GPS', fiscalYearId: 'fy1', budgetCount: 0, childCount: 1, isShared: false, sharedByAncestor: false },
  { id: 'n701', code: '7.701', name: 'Plan line as first written', parentId: 'n7', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0, isShared: false, sharedByAncestor: false },
  { id: 'n19', code: '19.100', name: 'Cross-border project', fiscalYearId: 'fy1', budgetCount: 0, childCount: 0, isShared: false, sharedByAncestor: false },
  // Another fiscal year reuses the numbering. A parent there would attach this year's money to
  // last year's plan, so it must never be on offer.
  { id: 'old19', code: '19.100', name: 'Cross-border project', fiscalYearId: 'fy0', budgetCount: 0, childCount: 0, isShared: false, sharedByAncestor: false },
];
const BUDGETS = [
  { id: 'b701', node: { id: 'n701', code: '7.701' }, budgetName: 'Money sitting at the line', amountTotal: '3010893600', available: '3010893600', status: 'ACTIVE', fiscalYear: CUR },
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
  const { useBudgetsStore } = await import('../../stores/budgets');
  const store = useBudgetsStore();
  store.listMode = 'tree';
  await store.loadTree();
  await flushPromises();
  // PrimeVue paints the TreeTable body on its own tick, which `flushPromises` does not wait for.
  // `v-can` hides rather than unmounts, so the element exists for a reader too and only its
  // visibility differs — which is what the permission test below asks about.
  await vi.waitUntil(() => w.findAll('[data-testid="edit-node"]').length > 0, {
    timeout: 2000,
    interval: 10,
  });
  return w;
}

const visibleEdits = (w: any) =>
  w.findAll('[data-testid="edit-node"]')
    .filter((b: any) => (b.element as HTMLElement).style.display !== 'none');

beforeEach(() => {
  vi.clearAllMocks();
  nodesMock.mockResolvedValue(NODES);
  listMock.mockResolvedValue({ items: BUDGETS, total: 1, page: 1, limit: 500 });
  updateNodeMock.mockResolvedValue({});
});

describe('the plan tree moves a node entered in the wrong place', () => {
  it('offers the edit to a BUDGET_MANAGE user and not to a reader', async () => {
    expect(visibleEdits(await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE'])).length).toBeGreaterThan(0);
    expect(visibleEdits(await openTree(['BUDGET_VIEW']))).toHaveLength(0);
  });

  it('sends the new parent and re-reads the tree', async () => {
    const w = await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    const { useBudgetsStore } = await import('../../stores/budgets');
    const store = useBudgetsStore();

    // Driven through the store rather than through the collapsed row's button: the TreeTable
    // renders only the roots until a reader expands it, and this harness cannot drive that toggle.
    // What the button does when clicked is one line — `openEditNode(node.data)` — and what it hands
    // over is asserted by the pre-fill test below.
    await store.editNode('n701', { name: 'Plan line as first written', parentId: 'n19' });

    expect(updateNodeMock).toHaveBeenCalledWith('n701', {
      name: 'Plan line as first written',
      parentId: 'n19',
    });
    // A move carries the node's subtree with it, so every total between the old parent and the new
    // one changes and no row can be patched in place.
    expect(nodesMock).toHaveBeenCalledTimes(2);
    expect(w.exists()).toBe(true);
  });

  it('detaches to the top of the plan when the parent is cleared', async () => {
    await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    const { useBudgetsStore } = await import('../../stores/budgets');
    // `null`, not `undefined`: the DTO reads an absent `parentId` as "leave it where it is", so
    // only an explicit null can say "put it at the root".
    await useBudgetsStore().editNode('n701', { name: 'x', parentId: null });
    expect(updateNodeMock).toHaveBeenCalledWith('n701', { name: 'x', parentId: null });
  });

  it('pre-fills from the NODE, not from the collapsed row that stands for it', async () => {
    // `7.701` holds one budget and no children, so the tree renders it as ONE row carrying the
    // budget's name — `Money sitting at the line`. Pre-filling the name field from that row would
    // offer to rename the plan line to whatever the money at it happens to be called, and saving
    // the untouched dialog would do it silently.
    const w = await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    (w.vm as any).openEditNode({ nodeId: 'n701', code: '7.701', name: 'Money sitting at the line' });
    await flushPromises();

    expect((w.vm as any).editNodeModel).toMatchObject({
      id: 'n701',
      code: '7.701',
      name: 'Plan line as first written',
      parentId: 'n7',
    });
  });

  it('will not offer a parent from another fiscal year, or the node\'s own subtree', async () => {
    const w = await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    // Asked of `7.70`, which HAS a subtree: `7.701` beneath it is the tempting wrong answer, and
    // the server would refuse it as a cycle after the user had already chosen it.
    (w.vm as any).openEditNode({ nodeId: 'n7', code: '7.70' });
    await flushPromises();

    const offered = ((w.vm as any).editNodeParentOptions as Array<{ value: string }>).map((o) => o.value);
    expect(offered).toContain('n19');
    expect(offered).not.toContain('n7');
    expect(offered).not.toContain('n701');
    // A plan is rewritten each year and keeps its numbering, so `19.100` exists once per year.
    // Offering last year's would attach this year's money to last year's plan.
    expect(offered).not.toContain('old19');
  });

  it('shows the code but does not let it be typed in', async () => {
    const w = await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    (w.vm as any).openEditNode({ nodeId: 'n701', code: '7.701' });
    await flushPromises();

    // The code is the budget's identity in every document and every history row that mentions it.
    // A field that accepts a new one would rewrite what those records appear to say.
    const codeField = w.findAll('input').find((i) => (i.element as HTMLInputElement).value === '7.701');
    expect(codeField).toBeTruthy();
    expect((codeField!.element as HTMLInputElement).disabled).toBe(true);
  });

  it('surfaces the server refusal instead of closing on a failed save', async () => {
    await openTree(['BUDGET_VIEW', 'BUDGET_MANAGE']);
    const { useBudgetsStore } = await import('../../stores/budgets');
    updateNodeMock.mockRejectedValueOnce(new Error('Parent node n19 is not in the same fiscal year'));
    await expect(useBudgetsStore().editNode('n701', { parentId: 'n19' })).rejects.toThrow();
    // Not re-read: nothing moved, so the tree on screen is still the truth.
    expect(nodesMock).toHaveBeenCalledTimes(1);
  });
});
