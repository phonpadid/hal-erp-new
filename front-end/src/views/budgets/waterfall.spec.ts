import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import type { BalanceBreakdown } from '../../api/budgets';
import { i18n } from '../../i18n';
import { formatAmount } from '../../utils/money';
import { useAuthStore } from '../../stores/auth';
import { can } from '../../directives/can';
import { buildWaterfallSteps } from './waterfall';

const zero = { adjustIncrease: '0', adjustDecrease: '0', transferIn: '0', transferOut: '0', reserved: '0', actual: '0', released: '0' };
function breakdown(over: Partial<BalanceBreakdown>): BalanceBreakdown {
  return { amountTotal: '0', available: '0', ...zero, ...over } as BalanceBreakdown;
}

describe('buildWaterfallSteps', () => {
  it('reconciles the final running balance to available (invariant 3)', () => {
    // total 1,000,000 − reserved 100,000 + released 40,000 → 940,000
    const b = breakdown({ amountTotal: '1000000.00', reserved: '100000', released: '40000', available: '940000' });
    const steps = buildWaterfallSteps(b);

    // last movement before the grounded available bar ends exactly at available
    const lastMovement = steps[steps.length - 2];
    expect(String(lastMovement.range[1])).toBe('940000');

    const availableStep = steps[steps.length - 1];
    expect(availableStep.key).toBe('available');
    expect(availableStep.range).toEqual([0, 940000]);
    // and it matches the breakdown's derived available
    expect(availableStep.amount).toBe(b.available);
  });

  it('starts at the total and grounds the first bar at zero', () => {
    const steps = buildWaterfallSteps(breakdown({ amountTotal: '1000000.00', available: '1000000' }));
    expect(steps[0].key).toBe('amountTotal');
    expect(steps[0].range).toEqual([0, 1000000]);
    // no movements → only start + available
    expect(steps).toHaveLength(2);
  });

  it('floats each movement and tags increase/decrease kinds', () => {
    const steps = buildWaterfallSteps(breakdown({ amountTotal: '1000000', reserved: '100000', released: '40000', available: '940000' }));
    const reserved = steps.find((s) => s.key === 'reserved')!;
    const released = steps.find((s) => s.key === 'released')!;
    expect(reserved.kind).toBe('decrease');
    expect(reserved.range).toEqual([1000000, 900000]);
    expect(released.kind).toBe('increase');
    expect(released.range).toEqual([900000, 940000]);
  });

  it('formats step amounts to the currency decimal places, never a JS number', () => {
    const steps = buildWaterfallSteps(breakdown({ amountTotal: '1000000', reserved: '100000', available: '900000' }));
    const reserved = steps.find((s) => s.key === 'reserved')!;
    // amount carried as a string; display honors a 0-decimal currency (no hardcoded 2)
    expect(typeof reserved.amount).toBe('string');
    expect(formatAmount(reserved.amount, 0)).toBe('100,000');
    expect(formatAmount(reserved.amount, 3)).toBe('100,000.000');
  });
});

// The detail view loads the budget + breakdown through the store; mock the API so the
// view reaches the rendered state without a network call.
vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    budgetsApi: {
      get: vi.fn().mockResolvedValue({
        id: 'b1', budgetName: 'Travel', glAccount: '5000', status: 'ACTIVE', amountTotal: '1000000',
        fiscalYear: { company: { baseCurrency: { code: 'THB', decimalPlaces: 2 } } },
      }),
      breakdown: vi.fn().mockResolvedValue({
        amountTotal: '1000000', adjustIncrease: '0', adjustDecrease: '0', transferIn: '0',
        transferOut: '0', reserved: '100000', actual: '0', released: '40000', available: '940000',
      }),
      ledger: vi.fn().mockResolvedValue([]),
    },
  };
});

describe('BudgetDetailView waterfall gating', () => {
  async function mountWith(permissions: string[]) {
    const pinia = createPinia();
    setActivePinia(pinia);
    useAuthStore().permissions = permissions;

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/budgets/:id', name: 'budget-detail', component: { template: '<div />' } },
        { path: '/budgets/:id/edit', name: 'budget-edit', component: { template: '<div />' } },
        { path: '/documents/:id', name: 'document-detail', component: { template: '<div />' } },
      ],
    });
    router.push('/budgets/b1');
    await router.isReady();

    const { default: BudgetDetailView } = await import('./BudgetDetailView.vue');
    const w = mount(BudgetDetailView, { global: { plugins: [i18n, PrimeVue, ToastService, ConfirmationService, router, pinia], directives: { can }, stubs: { teleport: true } } });
    await flushPromises();
    return w;
  }

  it('renders the waterfall chart with BUDGET_VIEW', async () => {
    const w = await mountWith(['BUDGET_VIEW']);
    expect(w.findComponent({ name: 'BudgetWaterfallChart' }).exists()).toBe(true);
  });

  it('does not render the waterfall chart without BUDGET_VIEW', async () => {
    const w = await mountWith([]);
    expect(w.findComponent({ name: 'BudgetWaterfallChart' }).exists()).toBe(false);
  });
});
