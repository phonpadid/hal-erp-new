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
];
const CP = {
  id: 'cp-cat', fiscalYearId: 'fy1',
  accountNodeId: 'a1', accountNodeCode: '1.100', accountNodeName: 'General admin',
  departmentNodeId: 'd1', departmentNodeCode: 'ADMIN', departmentNodeName: 'Administration',
  capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
  ceiling: '534000000', used: '487208500', available: '46791500',
  governedBudgetIds: ['b-101', 'b-104'],
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
    controlPointListMock.mockResolvedValue([CP]);
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
    expect(w.findComponent({ name: 'ProgressBar' }).exists()).toBe(true);
  });

  it('lets the bar take the slack rather than pinning it to a stub width', async () => {
    // At a fixed w-24 the track was ~84px, so 91.2% and 100% looked identical. Growing with the
    // row is what makes the remaining slice readable at all.
    const w = await mountList();
    const bar = w.findComponent({ name: 'ProgressBar' });
    expect(bar.classes()).toContain('flex-1');
    expect(bar.classes().some((c) => /^w-\d+$/.test(c))).toBe(false);
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
