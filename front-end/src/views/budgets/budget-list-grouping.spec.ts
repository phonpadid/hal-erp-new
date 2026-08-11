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
  { id: 'b-101', glAccount: '1.101', budgetName: 'Office supplies', amountTotal: '350000000', status: 'ACTIVE', available: '50000000', fiscalYear: CURRENCY },
  { id: 'b-104', glAccount: '1.104', budgetName: 'Drinking water', amountTotal: '24000000', status: 'ACTIVE', available: '-138208500', fiscalYear: CURRENCY },
  // An untouched group, so the 0% case is always exercised — that is where PrimeVue's own
  // ProgressBar label would have vanished.
  { id: 'b-200', glAccount: '2.001', budgetName: 'Untouched', amountTotal: '1000000', status: 'ACTIVE', available: '1000000', fiscalYear: CURRENCY },
];
const CP = {
  id: 'cp-cat', fiscalYearId: 'fy1',
  accountNodeId: 'a1', accountNodeCode: '1.100', accountNodeName: 'General admin',
  departmentNodeId: 'd1', departmentNodeCode: 'ADMIN', departmentNodeName: 'Administration',
  capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
  ceiling: '534000000', used: '487208500', available: '46791500',
  governedBudgetIds: ['b-101', 'b-104'],
};

const CP_UNUSED = {
  id: 'cp-unused', fiscalYearId: 'fy1',
  accountNodeId: 'a2', accountNodeCode: '2.000', accountNodeName: 'Untouched category',
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
