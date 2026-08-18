import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mountView } from '../../test/mountView';
import BudgetLedgerReconciliationView from './BudgetLedgerReconciliationView.vue';
import type { SkippedForWantOfBudget } from '../../api/journal';
import type { BudgetLedgerReconciliation } from '../../api/reports';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/** One account that reconciles and one that does not — the pair every marking assertion needs. */
const RECONCILIATION: BudgetLedgerReconciliation = {
  fiscalYear: { id: 'fy-1', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
  fiscalYears: [
    { id: 'fy-1', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
    { id: 'fy-0', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31' },
  ],
  rows: [
    {
      accountId: 'a-1',
      accountCode: '5000',
      accountName: 'Office Supplies',
      appropriated: '1000000',
      committed: '0',
      consumed: '600000',
      moved: '655000',
      difference: '55000',
      sourcesWithoutBudget: [
        { sourceType: 'MANUAL_JV', amount: '80000' },
        { sourceType: 'STOCK_TXN', amount: '35000' },
      ],
      sourcesWithoutBudgetTotal: '115000',
      capitalisedIntoStock: '60000',
      postingNeverArrived: '0',
      // A December document settled in January: charged to 2026's budget, posted into 2027.
      consumedBeforeItsYear: '0',
      consumedAfterItsYear: '40000',
      crossings: [{ documentId: 'd-9', documentNo: 'PR-9', txnDate: '2027-01-05', amount: '40000' }],
      crossingCount: 1,
      unexplained: '0',
    },
    {
      accountId: 'a-2',
      accountCode: '5100',
      accountName: 'Travel',
      appropriated: '200000',
      committed: '0',
      consumed: '10000',
      moved: '17500',
      difference: '7500',
      sourcesWithoutBudget: [],
      sourcesWithoutBudgetTotal: '0',
      capitalisedIntoStock: '0',
      postingNeverArrived: '0',
      consumedBeforeItsYear: '0',
      consumedAfterItsYear: '0',
      crossings: [],
      crossingCount: 0,
      unexplained: '7500',
    },
  ],
  vouchersOnBudgetedAccounts: {
    total: '80000',
    entries: [
      { entryId: 'e-1', entryDate: '2026-03-31', docNo: 'JV-0004', memo: 'Depreciation', amount: '80000' },
    ],
  },
};

const SKIPPED: SkippedForWantOfBudget[] = [
  {
    id: 's-1',
    sourceType: 'PAYMENT',
    sourceId: 'doc-9',
    documentId: 'doc-9',
    documentNo: 'PV-0099',
    documentStatus: 'COMPLETED',
    baseTotalAmount: '4200.00',
    lastAttemptAt: '2026-08-01T04:00:00.000Z',
  },
];

async function mount(
  permissions: string[] = ['REPORT_VIEW'],
  state: Partial<{ reconciliation: BudgetLedgerReconciliation | null; skipped: SkippedForWantOfBudget[] }> = {},
) {
  const w = await mountView(BudgetLedgerReconciliationView, {
    path: '/budget-ledger-reconciliation',
    routeName: 'budget-ledger-reconciliation',
    permissions,
    initialState: {
      reports: { reconciliation: RECONCILIATION, skipped: SKIPPED, ...state },
      auth: { baseCurrency: { code: 'LAK', decimalPlaces: 2 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('BudgetLedgerReconciliationView', () => {
  it('shows the unexplained remainder on the account row, without expanding it', async () => {
    const w = await mount();
    // Both rows carry the figure; neither expansion has been opened.
    const shown = [
      ...w.findAll('[data-testid="unexplained"]'),
      ...w.findAll('[data-testid="unexplained-flagged"]'),
    ].map((n) => n.text());
    expect(shown).toHaveLength(2);
    expect(shown).toContain('7,500.00');
    expect(w.find('[data-testid="cause-amount"]').exists()).toBe(false);
  });

  it('marks only the account whose remainder is not zero', async () => {
    const w = await mount();
    const flagged = w.findAll('[data-testid="unexplained-flagged"]');
    expect(flagged).toHaveLength(1);
    expect(flagged[0].text()).toBe('7,500.00');
    expect(w.findAll('[data-testid="unexplained"]')).toHaveLength(1);
  });

  it('warns when any account has an unexplained difference', async () => {
    const w = await mount();
    expect(w.find('[data-testid="unexplained-banner"]').exists()).toBe(true);
  });

  it('does not warn when every account reconciles', async () => {
    const clean: BudgetLedgerReconciliation = {
      ...RECONCILIATION,
      rows: [{ ...RECONCILIATION.rows[0] }],
    };
    const w = await mount(['REPORT_VIEW'], { reconciliation: clean });
    expect(w.find('[data-testid="unexplained-banner"]').exists()).toBe(false);
  });

  it('lists each named cause with its amount when a row is expanded', async () => {
    const w = await mount();
    await w.find('.p-datatable-row-toggle-button').trigger('click');
    await flushPromises();

    const text = w.text();
    expect(text).toContain('MANUAL_JV');
    expect(text).toContain('STOCK_TXN');
    // The two per-document causes are deductions, so they read as negative against the sources.
    const amounts = w.findAll('[data-testid="cause-amount"]').map((n) => n.text());
    expect(amounts).toContain('80,000.00');
    expect(amounts).toContain('-60,000.00');
  });

  it('shows the vouchers-on-budgeted-accounts figure and the vouchers behind it', async () => {
    const w = await mount();
    expect(w.find('[data-testid="voucher-total"]').text()).toBe('80,000.00');
    expect(w.text()).toContain('JV-0004');
  });

  it('shows the expenses skipped for want of a budget beside the reconciliation', async () => {
    const w = await mount();
    expect(w.find('[data-testid="skipped-doc"]').text()).toBe('PV-0099');
    expect(w.find('[data-testid="skipped-total"]').text()).toBe('4,200.00');
  });

  it('formats every amount at the base currency\'s decimal places', async () => {
    const w = await mount();
    // Never the raw string the server sent: '600000' would read as six hundred thousand kip only
    // to somebody who already knew the scale.
    expect(w.text()).toContain('600,000.00');
    expect(w.text()).toContain('655,000.00');
  });

  it('offers the fiscal years the server returned', async () => {
    const w = await mount();
    expect(w.find('[data-testid="fiscal-year"]').exists()).toBe(true);
  });

  // The figure says how much crossed the year boundary; the list says which documents, which is the
  // only follow-up question it provokes.
  it('names the documents that crossed the year boundary', async () => {
    const w = await mount();
    await w.find('.p-datatable-row-toggle-button').trigger('click');
    await flushPromises();
    const text = w.text();
    expect(text).toContain('PR-9');
    expect(text).toContain('2027-01-05');
  });

  it('reports the crossing as its own cause rather than folding it into the remainder', async () => {
    const w = await mount();
    await w.find('.p-datatable-row-toggle-button').trigger('click');
    await flushPromises();
    const amounts = w.findAll('[data-testid="cause-amount"]').map((n) => n.text());
    // The late crossing is a deduction like the other per-document causes.
    expect(amounts).toContain('-40,000.00');
    // Its zero twin is not listed: an early crossing that did not happen is not a cause.
    expect(w.text()).not.toContain('posted before it began');
  });

  // The server caps the list it sends. A cap that stays quiet reports a smaller problem than the
  // one that exists — a reader cannot tell ten crossings from a hundred.
  it('says how many crossings it did not list', async () => {
    const capped: BudgetLedgerReconciliation = {
      ...RECONCILIATION,
      rows: [{ ...RECONCILIATION.rows[0], crossingCount: 13 }, RECONCILIATION.rows[1]],
    };
    const w = await mount(['REPORT_VIEW'], { reconciliation: capped });
    await w.find('.p-datatable-row-toggle-button').trigger('click');
    await flushPromises();
    // Thirteen crossed; one came down in the list.
    expect(w.text()).toContain('12');
  });
});
