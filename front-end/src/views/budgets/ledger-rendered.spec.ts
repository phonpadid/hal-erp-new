import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import { i18n } from '../../i18n';
import { useAuthStore } from '../../stores/auth';
import { can } from '../../directives/can';

/**
 * Read the signs the ledger ACTUALLY DRAWS, out of the mounted view.
 *
 * `ledger-direction.spec.ts` beside this one asserts the shared classification, which is necessary
 * and not sufficient: the defect was a template that ignored it. A test that re-derives the sign
 * from the data would pass against the broken screen, so this one parses the rendered cells.
 *
 * The fixture is the seeded Office Supplies budget as it stood on the running app: appropriated
 * 1,000,000, available 815,000, and a ledger the old screen summed to −270,000.
 */
const entry = (id: string, txnType: string, amount: string, docNo: string) => ({
  id, txnType, amount, documentId: docNo, documentNo: docNo, remark: null,
  createdAt: '2026-08-19T00:00:00Z',
});
const LEDGER = [
  entry('l1', 'ACTUAL', '35000', 'CLAIM-HAL-2026-0002'),
  entry('l2', 'RESERVE', '35000', 'CLAIM-HAL-2026-0002'),
  entry('l3', 'ACTUAL', '50000', 'PR-HAL-2026-0001'),
  entry('l4', 'RESERVE', '50000', 'PROC-HAL-2026-0001'),
  entry('l5', 'RESERVE', '50000', 'PR-HAL-2026-0001'),
  entry('l6', 'RESERVE', '50000', 'CLAIM-HAL-2026-0001'),
];

vi.mock('../../api/budgets', async (orig) => {
  const actual = (await orig()) as { budgetsApi: Record<string, unknown> };
  return {
    ...actual,
    budgetsApi: {
      ...actual.budgetsApi,
      get: vi.fn().mockResolvedValue({
        id: 'b1', budgetName: 'Office Supplies', glAccount: '5000', status: 'ACTIVE',
        amountTotal: '1000000',
        fiscalYear: { company: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } } },
      }),
      breakdown: vi.fn().mockResolvedValue({
        amountTotal: '1000000', adjustIncrease: '0', adjustDecrease: '0', transferIn: '0',
        transferOut: '0', reserved: '185000', actual: '85000', released: '0', available: '815000',
      }),
      controlPoints: vi.fn().mockResolvedValue([]),
      ledger: vi.fn().mockResolvedValue({ items: LEDGER, total: LEDGER.length, page: 1, limit: 20 }),
    },
  };
});

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().permissions = ['BUDGET_VIEW'];

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
  const w = mount(BudgetDetailView, {
    global: {
      plugins: [i18n, PrimeVue, ToastService, ConfirmationService, router, pinia],
      directives: { can },
      stubs: { teleport: true },
    },
  });
  await flushPromises();
  return w;
}

/** Every amount cell the ledger drew, as {direction, text}. */
function renderedAmounts(w: Awaited<ReturnType<typeof mountView>>) {
  return w.findAll('[data-direction]').map((el) => ({
    direction: el.attributes('data-direction'),
    text: el.text().replace(/\s+/g, ''),
  }));
}

/** Sum the ledger the way a reader would: by the sign printed in front of each amount. */
function sumWhatIsPrinted(cells: { text: string }[]) {
  return cells.reduce((acc, c) => {
    const m = c.text.match(/^([+−-]?)([\d,]+)/);
    if (!m) return acc;
    const n = Number(m[2].replace(/,/g, ''));
    return acc + (m[1] === '+' ? n : m[1] ? -n : 0);
  }, 0);
}

describe('the rendered budget ledger', () => {
  it('sums to the amount the budget actually lost', async () => {
    const cells = renderedAmounts(await mountView());
    expect(cells).toHaveLength(LEDGER.length);
    // available − amountTotal = 815,000 − 1,000,000
    expect(sumWhatIsPrinted(cells)).toBe(-185_000);
  });

  it('does not print a settlement as a withdrawal', async () => {
    const cells = renderedAmounts(await mountView());
    const settlements = cells.filter((c) => c.direction === 'CONVERTS');
    expect(settlements).toHaveLength(2);
    for (const s of settlements) {
      expect(s.text.startsWith('−')).toBe(false);
      expect(s.text.startsWith('-')).toBe(false);
      expect(s.text.startsWith('+')).toBe(false);
    }
  });

  it('deducts a settled document once, though it appears twice', async () => {
    // CLAIM-HAL-2026-0002 reserved 35,000 and settled for 35,000. Two rows, one deduction — the
    // screen used to print −35,000 twice and read as 70,000 gone.
    const cells = renderedAmounts(await mountView());
    const claim = cells.filter((c) => c.text.includes('35,000'));
    expect(claim).toHaveLength(2);
    expect(sumWhatIsPrinted(claim)).toBe(-35_000);
  });

  it('keeps a settlement legible rather than blank', async () => {
    // No sign is not the same as no value: the amount is still shown in full, at the currency's
    // decimal places (0 here), so the row cannot be read as missing data.
    const cells = renderedAmounts(await mountView());
    const settlement = cells.find((c) => c.direction === 'CONVERTS')!;
    expect(settlement.text).toContain('35,000');
    expect(settlement.text).not.toContain('.');
  });

  it('still signs the entries that do move the balance', async () => {
    const cells = renderedAmounts(await mountView());
    for (const c of cells.filter((x) => x.direction === 'SUBTRACTS')) {
      expect(c.text.startsWith('−')).toBe(true);
    }
  });
});
