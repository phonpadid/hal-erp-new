import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { can } from '../../directives/can';
import { useAuthStore } from '../../stores/auth';

/**
 * The tree's rolled-up figures, and the budgets that must not be in them.
 *
 * The shape here is the one the defect arrived in: `BUDGET_PLAN-HAL-2026-0002` was withdrawn, its
 * budget at node `1.102` was correctly marked `REJECTED` — and the tree went on totalling its
 * 30,000,000 through `1.100` into the department root, so a company with nothing approved showed a
 * ceiling of thirty million. Node `1.102` holds exactly one budget and no children, which is the
 * branch that renders one row for both, with no Σ and no status anywhere near the figure.
 */
const CURRENCY = { company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } };

const BUDGETS = [
  // The bug, exactly: one refused budget alone under its own plan line.
  { id: 'b-102', node: { id: 'n-102', code: '1.102' }, budgetName: 'Cleaning equipment', amountTotal: '30000000', status: 'REJECTED', available: '30000000', fiscalYear: CURRENCY },
  // A category mixing money in force with money still waiting for it.
  { id: 'b-201', node: { id: 'n-201', code: '2.001' }, budgetName: 'In force', amountTotal: '12000000', status: 'ACTIVE', available: '12000000', fiscalYear: CURRENCY },
  { id: 'b-202', node: { id: 'n-202', code: '2.002' }, budgetName: 'Awaiting approval', amountTotal: '5000000', status: 'DRAFT', available: '5000000', fiscalYear: CURRENCY },
  // An appropriation that ran its year. Still money, still counted.
  { id: 'b-203', node: { id: 'n-203', code: '2.003' }, budgetName: 'Last year', amountTotal: '7000000', status: 'CLOSED', available: '0', fiscalYear: CURRENCY },
  // Reachable through the budget edit form and present in no declared list. An allow-list keeps it
  // out; a deny-list of DRAFT/REJECTED would have let it in.
  { id: 'b-204', node: { id: 'n-204', code: '2.004' }, budgetName: 'Undeclared', amountTotal: '9000000', status: 'INACTIVE', available: '9000000', fiscalYear: CURRENCY },
  // A refused line standing at a ROOT node. Deliberate: PrimeVue's TreeTable renders only the roots
  // until a reader expands it, and this harness cannot drive that toggle, so a mark on a nested row
  // could never be asserted against the real template.
  { id: 'b-300', node: { id: 'n-300', code: '3' }, budgetName: 'Refused at the root', amountTotal: '4000000', status: 'REJECTED', available: '4000000', fiscalYear: CURRENCY },
];

const NODES = [
  { id: 'n-1', code: '1', name: 'Administration', fiscalYearId: 'fy1', budgetCount: 0, childCount: 1 },
  { id: 'n-100', code: '1.100', name: 'General admin', parentId: 'n-1', fiscalYearId: 'fy1', budgetCount: 0, childCount: 1 },
  { id: 'n-102', code: '1.102', name: 'Cleaning equipment', parentId: 'n-100', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
  { id: 'n-2', code: '2', name: 'Operations', fiscalYearId: 'fy1', budgetCount: 0, childCount: 4 },
  { id: 'n-201', code: '2.001', name: 'In force', parentId: 'n-2', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
  { id: 'n-202', code: '2.002', name: 'Awaiting approval', parentId: 'n-2', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
  { id: 'n-203', code: '2.003', name: 'Last year', parentId: 'n-2', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
  { id: 'n-204', code: '2.004', name: 'Undeclared', parentId: 'n-2', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
  { id: 'n-300', code: '3', name: 'Refused at the root', fiscalYearId: 'fy1', budgetCount: 1, childCount: 0 },
];

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      list: vi.fn().mockResolvedValue({ items: BUDGETS, total: BUDGETS.length, page: 1, limit: 20 }),
      nodes: vi.fn().mockResolvedValue(NODES),
      controlPointList: vi.fn().mockResolvedValue([]),
    },
  };
});

async function mountTree() {
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
  const { useBudgetsStore } = await import('../../stores/budgets');
  const s = useBudgetsStore();
  s.nodes = NODES as never;
  s.setListMode('tree');
  await flushPromises();
  return { w, s };
}

/** Depth-first lookup by plan code — the tree nests, and the row wanted is rarely at the root. */
function findByCode(nodes: any[], code: string): any | undefined {
  for (const n of nodes) {
    if (n.data.code === code) return n;
    const hit = findByCode(n.children ?? [], code);
    if (hit) return hit;
  }
  return undefined;
}

describe('the budget tree totals only the budgets that are money', () => {
  it('does not count a refused budget into the nodes above it', async () => {
    const { s } = await mountTree();
    // The one budget beneath all three was refused, so there is no money here to total.
    expect(findByCode(s.budgetTree, '1.102')!.data.amountTotal).toBe('30000000');
    expect(findByCode(s.budgetTree, '1.100')!.data.amountTotal).toBe('0');
    expect(findByCode(s.budgetTree, '1')!.data.amountTotal).toBe('0');
  });

  it('does not count a budget still awaiting its approval', async () => {
    const { s } = await mountTree();
    // 12,000,000 ACTIVE + 7,000,000 CLOSED. The DRAFT's 5,000,000 and the INACTIVE's 9,000,000 stay out.
    expect(findByCode(s.budgetTree, '2')!.data.amountTotal).toBe('19000000');
  });

  it('counts a closed budget, which is an appropriation that ran its year', async () => {
    const { s } = await mountTree();
    expect(findByCode(s.budgetTree, '2.003')!.data.counted).toBe(true);
  });

  it('keeps a status in no declared list out of the totals', async () => {
    const { s } = await mountTree();
    // An allow-list decides this. A deny-list of DRAFT/REJECTED would have admitted INACTIVE.
    expect(findByCode(s.budgetTree, '2.004')!.data.counted).toBe(false);
  });

  it('keeps an uncounted budget in the tree rather than dropping it', async () => {
    const { s } = await mountTree();
    // A department head whose plan was withdrawn must be able to see what became of the line.
    for (const code of ['1.102', '2.002', '2.004']) {
      expect(findByCode(s.budgetTree, code)).toBeDefined();
    }
  });

  it('rolls a node up over every budget beneath it, however the money was counted', async () => {
    const { s } = await mountTree();
    // The reach of a shared-budget mark, not a money figure: a mark covers the DRAFT the day its
    // plan is approved, so all four lines beneath `2` are within it.
    expect(findByCode(s.budgetTree, '2')!.data.budgetCount).toBe(4);
  });

  it('sums as strings, never through a JS number', async () => {
    const { s } = await mountTree();
    expect(typeof findByCode(s.budgetTree, '2')!.data.amountTotal).toBe('string');
    expect(findByCode(s.budgetTree, '2')!.data.available).toBe('12000000');
  });

  it('carries the mark on every uncounted row, at whatever depth', async () => {
    const { s } = await mountTree();
    // Asserted on the row data for the nested ones: the TreeTable renders only its roots until a
    // reader expands it, and this harness cannot drive that toggle. The rendering test below
    // exercises the template itself, on a refused line that stands at a root.
    for (const code of ['1.102', '2.002', '2.004', '3']) {
      expect(findByCode(s.budgetTree, code)!.data.counted).toBe(false);
    }
    expect(findByCode(s.budgetTree, '1.102')!.data.status).toBe('REJECTED');
  });

  it('marks an uncounted row with its status so its zero is explained', async () => {
    const { w } = await mountTree();
    const marks = w.findAll('[data-testid="not-counted"]');
    expect(marks).toHaveLength(1);
    // Through i18n rather than a literal: the app's default locale is Lao, and an English literal
    // would pass only by never matching anything.
    expect(marks[0].text()).toContain(i18n.global.t('budgets.status.REJECTED'));
  });

  it('leaves a budget that is money unmarked', async () => {
    const { w, s } = await mountTree();
    // Nothing in force carries the mark, at any depth...
    for (const code of ['2.001', '2.003']) {
      expect(findByCode(s.budgetTree, code)!.data.counted).toBe(true);
    }
    // ...and the roots the template actually rendered agree.
    const marked = w.findAll('[data-testid="not-counted"]').map((m) => m.text());
    expect(marked).not.toContain(i18n.global.t('budgets.status.ACTIVE'));
    expect(marked).not.toContain(i18n.global.t('budgets.status.CLOSED'));
  });
});
