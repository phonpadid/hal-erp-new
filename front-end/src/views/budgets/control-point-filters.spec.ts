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
 * The control points screen's two filters, applied on the CLIENT.
 *
 * Client-side is correct here and server-side is correct on the budget list, which is not an
 * inconsistency but the same rule: a control must narrow the set the list is drawn from.
 * `BudgetControlPointService.list` does not page — it returns every point, because each row's
 * ceiling/used/available is resolved for the whole set in a fixed number of queries — so the
 * client holds all of them and filtering here IS filtering all of them.
 *
 * These therefore assert on ROWS, not on requests: no second request should happen at all.
 */
const cp = (over: Record<string, unknown>) => ({
  id: 'cp-1', fiscalYearId: 'fy1',
  budgetNodeId: 'a1', budgetNodeCode: '1.100', budgetNodeName: 'General admin',
  departmentNodeId: 'd-admin', departmentNodeCode: 'ADMIN', departmentNodeName: 'Administration',
  capAmount: null, tolerance: [{ at: 100, action: 'BLOCK' as const }], isActive: true,
  ceiling: '100', used: '0', available: '100', governedBudgetIds: [],
  ...over,
});

const POINTS = [
  cp({ id: 'cp-a', budgetNodeCode: '1.100', budgetNodeName: 'Office supplies' }),
  cp({ id: 'cp-b', budgetNodeCode: '1.200', budgetNodeName: 'Drinking water' }),
  cp({ id: 'cp-c', budgetNodeCode: '2.100', budgetNodeName: 'Marketing spend', departmentNodeId: 'd-mkt', departmentNodeCode: 'MKT', departmentNodeName: 'Marketing' }),
  cp({ id: 'cp-d', budgetNodeCode: '3.100', budgetNodeName: 'Retired point', isActive: false }),
];

const controlPointListMock = vi.fn();

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      controlPointList: (...args: unknown[]) => controlPointListMock(...args),
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    },
  };
});

async function mountScreen() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = ['BUDGET_VIEW'];
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budgets/control-points', name: 'control-points', component: { template: '<div />' } },
      { path: '/budgets/control-points/:id', name: 'control-point-detail', component: { template: '<div />' } },
    ],
  });
  router.push('/budgets/control-points');
  await router.isReady();
  const { default: View } = await import('./ControlPointListView.vue');
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

/** Data rows currently rendered, by the budget node name in each. */
const shown = (w: Awaited<ReturnType<typeof mountScreen>>) =>
  POINTS.filter((p) => w.text().includes(p.budgetNodeName)).map((p) => p.budgetNodeName);

describe('control point filters', () => {
  beforeEach(() => {
    controlPointListMock.mockReset();
    controlPointListMock.mockResolvedValue(POINTS);
  });

  it('shows every point before anything is narrowed', async () => {
    const w = await mountScreen();
    expect(shown(w)).toHaveLength(4);
  });

  it('narrows to one department node, without asking the server again', async () => {
    const w = await mountScreen();
    controlPointListMock.mockClear();
    (w.vm as unknown as { departmentNodeId: string }).departmentNodeId = 'd-mkt';
    await flushPromises();

    expect(shown(w)).toEqual(['Marketing spend']);
    // The whole set is already here. A request would be the screen forgetting that.
    expect(controlPointListMock).not.toHaveBeenCalled();
  });

  it('narrows to inactive points', async () => {
    const w = await mountScreen();
    (w.vm as unknown as { active: boolean | null }).active = false;
    await flushPromises();
    expect(shown(w)).toEqual(['Retired point']);
  });

  it('narrows to active points', async () => {
    const w = await mountScreen();
    (w.vm as unknown as { active: boolean | null }).active = true;
    await flushPromises();
    expect(shown(w)).not.toContain('Retired point');
    expect(shown(w)).toHaveLength(3);
  });

  it('composes a filter with the search term', async () => {
    const w = await mountScreen();
    const vm = w.vm as unknown as { departmentNodeId: string; term: string };
    vm.departmentNodeId = 'd-admin';
    vm.term = 'water';
    await flushPromises();
    expect(shown(w)).toEqual(['Drinking water']);
  });

  it('searches across every loaded row, not the visible page', async () => {
    // Forty-five points so the first page cannot hold them; the match is deliberately last.
    const many = Array.from({ length: 45 }, (_, i) =>
      cp({ id: `cp-${i}`, budgetNodeCode: `9.${i}`, budgetNodeName: i === 44 ? 'Needle' : `Filler ${i}` }),
    );
    controlPointListMock.mockResolvedValue(many);
    const w = await mountScreen();
    expect(w.text()).not.toContain('Needle');

    (w.vm as unknown as { term: string }).term = 'needle';
    await flushPromises();
    expect(w.text()).toContain('Needle');
  });

  it('states what it is hiding, and only while something is set', async () => {
    const w = await mountScreen();
    expect(w.text()).not.toContain('ສະແດງ');

    (w.vm as unknown as { active: boolean | null }).active = false;
    await flushPromises();
    expect(w.text()).toContain('ສະແດງ 1 ຈາກ 4');
  });

  it('distinguishes an over-filtered list from a genuinely empty one', async () => {
    const w = await mountScreen();
    (w.vm as unknown as { term: string }).term = 'zzz-no-such-point';
    await flushPromises();
    // "No control point exists" carries a warning worth not raising falsely here: every active
    // budget must be governed by one, and the screen says so.
    expect(w.text()).toContain('ບໍ່ມີງົບປະມານທີ່ກົງກັບເງື່ອນໄຂທີ່ທ່ານກັ່ນຕອງ');
    expect(w.text()).not.toContain('ງົບທີ່ໃຊ້ງານທຸກໃບຕ້ອງມີຈຸດຄວບຄຸມ');
  });

  it('shows the real warning when there are genuinely no points', async () => {
    // The counterpart to the test above, so that one cannot pass by asserting the absence of a
    // string the screen never renders. With nothing narrowed and nothing loaded, the hint appears.
    controlPointListMock.mockResolvedValue([]);
    const w = await mountScreen();
    expect(w.text()).toContain('ງົບທີ່ໃຊ້ງານທຸກໃບຕ້ອງມີຈຸດຄວບຄຸມ');
  });

  it('clearing brings every point back', async () => {
    const w = await mountScreen();
    const vm = w.vm as unknown as { term: string; clearNarrowing: () => void };
    vm.term = 'zzz-no-such-point';
    await flushPromises();
    vm.clearNarrowing();
    await flushPromises();
    expect(shown(w)).toHaveLength(4);
  });
});
