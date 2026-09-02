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
 * The grouped budget list, and the two reading defects that shipped in its first cut:
 * money left-aligned in proportional figures, and an overdrawn line rendered exactly like a
 * healthy one. Both are pinned here because both are invisible to a type check and to every
 * behavioural test — the screen keeps working while becoming unreadable.
 */
const CURRENCY = { company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } };
const BUDGETS = [
  { id: 'b-101', node: { id: 'n-101', code: '1.101' }, glAccount: '658.0007', budgetName: 'Office supplies', amountTotal: '350000000', status: 'ACTIVE', available: '50000000', fiscalYear: CURRENCY },
  // Same GL account as b-101, which the old model could not represent at all: it is the reason the
  // code on a row comes from the node.
  { id: 'b-104', node: { id: 'n-104', code: '1.104' }, glAccount: '658.0007', budgetName: 'Drinking water', amountTotal: '24000000', status: 'ACTIVE', available: '-138208500', fiscalYear: CURRENCY },
  // An untouched group, so the 0% case is always exercised — that is where PrimeVue's own
  // ProgressBar label would have vanished.
  { id: 'b-200', node: { id: 'n-200', code: '2.001' }, glAccount: '2.001', budgetName: 'Untouched', amountTotal: '1000000', status: 'ACTIVE', available: '1000000', fiscalYear: CURRENCY },
];

// The plan the budgets above were written in: one category with the two admin lines beneath it,
// and one line standing on its own at the root.
const NODES = [
  { id: 'n-1', code: '1', name: 'General admin', fiscalYearId: 'fy1', budgetCount: 0, childCount: 2 },
  { id: 'n-101', code: '1.101', name: 'Office supplies', parentId: 'n-1', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
  { id: 'n-104', code: '1.104', name: 'Drinking water', parentId: 'n-1', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
  { id: 'n-200', code: '2.001', name: 'Untouched', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
];
const CP = {
  id: 'cp-cat', fiscalYearId: 'fy1',
  budgetNodeId: 'a1', budgetNodeCode: '1.100', budgetNodeName: 'General admin',
  departmentNodeId: 'd1', departmentNodeCode: 'ADMIN', departmentNodeName: 'Administration',
  capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
  ceiling: '534000000', used: '487208500', available: '46791500',
  governedBudgetIds: ['b-101', 'b-104'],
};

const CP_UNUSED = {
  id: 'cp-unused', fiscalYearId: 'fy1',
  budgetNodeId: 'a2', budgetNodeCode: '2.000', budgetNodeName: 'Untouched category',
  departmentNodeId: 'd1', departmentNodeCode: 'ADMIN', departmentNodeName: 'Administration',
  capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
  ceiling: '1000000', used: '0', available: '1000000',
  governedBudgetIds: ['b-200'],
};

const controlPointListMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      list: vi.fn().mockResolvedValue({ items: BUDGETS, total: BUDGETS.length, page: 1, limit: 20 }),
      nodes: vi.fn().mockResolvedValue(NODES),
      controlPointList: (...args: unknown[]) => controlPointListMock(...args),
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

describe('budget list grouping', () => {
  beforeEach(() => {
    controlPointListMock.mockReset();
    controlPointListMock.mockResolvedValue([CP, CP_UNUSED]);
  });

  it('shows the group header with the control point and its whole-group figures', async () => {
    const w = await mountList();
    const text = w.text();
    expect(text).toContain('1.100');
    expect(text).toContain('General admin');
    expect(text).toContain('46,791,500');
    expect(text).toContain('534,000,000');
  });

  it('marks an overdrawn budget so it cannot read as a healthy one', async () => {
    const w = await mountList();
    const overdrawn = w.findAll('span').filter((s) => s.text().trim() === '-138,208,500');
    expect(overdrawn.length).toBeGreaterThan(0);
    expect(overdrawn.some((s) => s.classes().some((c) => c.includes('red')))).toBe(true);
  });

  it('does not mark a healthy budget as overdrawn', async () => {
    const w = await mountList();
    const healthy = w.findAll('span').filter((s) => s.text().trim() === '50,000,000');
    expect(healthy.length).toBeGreaterThan(0);
    expect(healthy.every((s) => !s.classes().some((c) => c.includes('red')))).toBe(true);
  });

  it('right-aligns money in tabular figures so digits line up down the column', async () => {
    const w = await mountList();
    const html = w.html();
    expect(html).toContain('tabular-nums');
    expect(html).toMatch(/text-right/);
  });

  it('shows how full the group is', async () => {
    // 487,208,500 of 534,000,000 — the fastest read on the screen, and the number the
    // spreadsheet had a column for.
    const w = await mountList();
    expect(w.text()).toContain('91.2%');
    const fill = w.find('tr.p-datatable-row-group-header .p-progressbar-value');
    expect(fill.exists()).toBe(true);
    expect(fill.attributes('style')).toContain('91.2%');
    // Translucency must be in the colour, never in `opacity`: the figures are children of this
    // element, so an opacity here fades them too.
    expect(fill.attributes('style')).not.toContain('opacity');
  });

  it('keeps the figures readable on a group nothing has been spent from', async () => {
    // The reason the fill is drawn BEHIND the figures rather than through PrimeVue's ProgressBar
    // slot: that slot lives inside the filled portion and is skipped entirely when value === 0
    // (progressbar/index.mjs), so an untouched group would show its bar and lose its amounts.
    const w = await mountList();
    const headers = w.findAll('tr.p-datatable-row-group-header');
    const zero = headers.find((h) => h.text().includes('Untouched category'));
    expect(zero).toBeDefined();
    expect(zero!.text()).toContain('0%');
    expect(zero!.text()).toContain('1,000,000');
    // The label renders because the value is floored just above zero; the fill is still invisible.
    expect(zero!.find('.p-progressbar-label').exists()).toBe(true);
    // ...and the track is drawn, so a group nothing has been spent from still reads as a bar
    // rather than as bare text.
    expect(zero!.find('.p-progressbar').attributes('style')).toContain('background');
  });

  it('scales every fill against the same block so their lengths can be compared', async () => {
    // Earlier cuts got this wrong in both directions: a fixed w-24 track was ~84px, where 91.2%
    // and 100% looked identical; flex-1 then let it grow with the row, so a fill's length depended
    // on how long its group's NAME was. A column of bars is only worth drawing when the lengths
    // mean the same thing on every row, which needs one shared width and the name taking the slack.
    const w = await mountList();
    const bars = w.findAllComponents({ name: 'ProgressBar' });
    expect(bars.length).toBeGreaterThan(1);
    expect(bars.every((b) => b.classes().includes('w-96') && b.classes().includes('shrink-0'))).toBe(true);
    const name = w.find('tr.p-datatable-row-group-header a');
    expect(name.classes()).toContain('flex-1');
  });

  it('spans the group header across every column', async () => {
    // PrimeVue sets the row-group header cell to `columnsLength - 1`, leaving the last column with
    // no cell — and a browser paints no row background where no cell exists, so the header band
    // stopped short of the table's right edge. This asserts the override still covers every
    // column, so ADDING A COLUMN fails here instead of quietly going ragged on screen.
    const w = await mountList();
    const headerCells = w.findAll('thead th').length;
    const groupCell = w.find('tr.p-datatable-row-group-header td');
    expect(groupCell.exists()).toBe(true);
    expect(Number(groupCell.attributes('colspan'))).toBe(headerCells);
  });

  it('ends the table in an unbroken money block', async () => {
    // Status sits with the descriptive columns so every column from there right is an amount.
    // This is not only tidier: the group header spans the whole row, so its figures land against
    // the same right edge as the children's only while the last column is money. Put status back
    // on the end and the summary stops a column short of the numbers it summarises.
    const w = await mountList();
    const headers = w.findAll('thead th').map((h) => h.text().trim());
    const statusIdx = headers.findIndex((h) => h.includes('ສະຖານະ'));
    const totalIdx = headers.findIndex((h) => h.includes('ລວມ'));
    expect(statusIdx).toBeGreaterThan(-1);
    expect(totalIdx).toBeGreaterThan(statusIdx);
    // Nothing non-money after the money starts.
    expect(headers.slice(totalIdx)).toHaveLength(2);
  });

  it('mixes the fill more strongly in light mode than in dark', async () => {
    // jsdom does not resolve `color-mix`, so asserting the rendered pixels here would pass while
    // proving nothing. What is checked instead is the input that decides it: the percentage the
    // component chose for the active theme. The resolved colours are verified in the browser.
    const { useLayoutStore } = await import('@/layouts/store/layout.store');
    const dark = await mountList();
    const darkStyle = dark.find('tr.p-datatable-row-group-header .p-progressbar-value').attributes('style');
    expect(darkStyle).toContain('22%');

    useLayoutStore().layoutConfig.darkTheme = false;
    await flushPromises();
    const lightStyle = dark.find('tr.p-datatable-row-group-header .p-progressbar-value').attributes('style');
    expect(lightStyle).not.toContain('22%');
    expect(lightStyle).toContain('45%');
    // Still a token in both, never a literal colour.
    expect(darkStyle).toContain('var(--p-');
    expect(lightStyle).toContain('var(--p-');
  });

  it('restarts row numbers inside each group', async () => {
    // A count that runs through a heading it is not part of belongs to a flat list.
    const w = await mountList();
    const numbers = w
      .findAll('tr.p-datatable-tbody > tr, tbody tr:not(.p-datatable-row-group-header)')
      .map((r) => r.find('td')?.text().trim())
      .filter((t) => t && /^\d+$/.test(t));
    // Two groups: the first holds two budgets, the second one — so 1,2 then 1, never 1,2,3.
    expect(numbers.slice(0, 3)).toEqual(['1', '2', '1']);
  });

  it('offers a flat/grouped toggle, grouped by default', async () => {
    const w = await mountList();
    // Imported here, not at the top: a static import pulls in the api module before the mock
    // factory's fixtures are initialised.
    const { useBudgetsStore } = await import('../../stores/budgets');
    expect(w.findComponent({ name: 'SelectButton' }).exists()).toBe(true);
    expect(useBudgetsStore().listGrouped).toBe(true);
  });

  it('hides the group headers in flat mode without changing the rows', async () => {
    const w = await mountList();
    const { useBudgetsStore } = await import('../../stores/budgets');
    const groupedRows = w.findAll('tbody tr:not(.p-datatable-row-group-header)').length;
    useBudgetsStore().setListGrouped(false);
    await flushPromises();
    expect(w.text()).not.toContain('General admin');
    expect(w.findAll('tbody tr:not(.p-datatable-row-group-header)').length).toBe(groupedRows);
    // PrimeVue still emits one header row for the single bucket; it is marked so it can be
    // collapsed away entirely rather than left as an empty tinted band above the first budget.
    expect(w.find('tr.p-datatable-row-group-header').attributes('data-flat-group')).toBeDefined();
  });

  // ---- the plan's own shape (task 7.3) --------------------------------------------------

  it('shows each budget under the code of the node its money sits at', async () => {
    const w = await mountList();
    const text = w.text();
    expect(text).toContain('1.101');
    expect(text).toContain('1.104');
  });

  it('puts budgets under their nodes in the tree presentation', async () => {
    await mountList();
    const { useBudgetsStore } = await import('../../stores/budgets');
    const s = useBudgetsStore();
    s.nodes = NODES as never;
    s.setListMode('tree');
    await flushPromises();

    const tree = s.budgetTree;
    const admin = tree.find((n) => n.data.code === '1');
    expect(admin).toBeDefined();
    // The category holds the two lines; each line holds its budget.
    expect(admin!.children!.map((c) => c.data.code).sort()).toEqual(['1.101', '1.104']);
    // A budget at a root node stays at the root.
    expect(tree.some((n) => n.data.code === '2.001')).toBe(true);
  });

  it('totals a category from the budgets beneath it and marks it as a total', async () => {
    const w = await mountList();
    const { useBudgetsStore } = await import('../../stores/budgets');
    const s = useBudgetsStore();
    s.nodes = NODES as never;
    s.setListMode('tree');
    await flushPromises();

    const admin = s.budgetTree.find((n) => n.data.code === '1')!;
    // 350,000,000 + 24,000,000 — summed as strings, never through a JS number.
    expect(admin.data.amountTotal).toBe('374000000');
    expect(admin.data.kind).toBe('node');
    // On screen the figure carries the Σ mark, so it cannot read as an allocation someone made.
    expect(w.text()).toContain('374,000,000');
    expect(w.text()).toContain('Σ');
  });

  it('renders a node holding one budget as that budget, not as a category over it', async () => {
    // Otherwise the same figure appears twice — once on the node marked Σ, once on the budget
    // beneath it — and a plan line reads as a category that rolled something up.
    await mountList();
    const { useBudgetsStore } = await import('../../stores/budgets');
    const s = useBudgetsStore();
    s.nodes = NODES as never;
    s.setListMode('tree');
    await flushPromises();

    const line = s.budgetTree.find((n) => n.data.code === '2.001')!;
    expect(line.data.kind).toBe('budget');
    expect(line.children ?? []).toHaveLength(0);
    expect(line.data.amountTotal).toBe('1000000');
  });

  it('keeps an empty category in the tree, showing zero rather than hiding it', async () => {
    await mountList();
    const { useBudgetsStore } = await import('../../stores/budgets');
    const s = useBudgetsStore();
    s.nodes = [...NODES, { id: 'n-9', code: '9', name: 'Being written', fiscalYearId: 'fy1', budgetCount: 0, childCount: 0 }] as never;
    s.setListMode('tree');
    await flushPromises();

    const empty = s.budgetTree.find((n) => n.data.code === '9');
    expect(empty).toBeDefined();
    expect(empty!.data.amountTotal).toBe('0');
  });

  it('links the group header to the control point rather than to a budget', async () => {
    const w = await mountList();
    const links = w.findAll('a').map((a) => a.attributes('href') ?? '');
    expect(links.some((h) => h.includes('/budgets/control-points/cp-cat'))).toBe(true);
  });

  it('flags budgets no control point governs', async () => {
    controlPointListMock.mockResolvedValue([{ ...CP, governedBudgetIds: ['b-101'] }]);
    const w = await mountList();
    expect(w.text()).toContain('ບໍ່ມີຈຸດຄວບຄຸມໃດຄຸ້ມຄອງລາຍການເຫຼົ່ານີ້');
  });
});
