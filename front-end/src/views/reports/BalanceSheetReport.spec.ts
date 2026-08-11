import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import BalanceSheetReport from './BalanceSheetReport.vue';
import type { BalanceSheet } from '../../api/financialReports';

/**
 * The screen carries two retained-earnings figures with opposite arithmetic — brought forward is
 * already inside `equityTotal`, the current period is a term of its own. The fixture keeps them at
 * DIFFERENT non-zero values on purpose: equal values would pass a screen that renders one twice.
 */
const sheet = (broughtForward: string): BalanceSheet => ({
  asOf: undefined,
  assets: [
    { accountId: 'a1', code: '1000', name: 'Cash', accountType: 'ASSET', amount: '540000.00' },
  ],
  liabilities: [
    { accountId: 'l1', code: '2000', name: 'Accounts Payable', accountType: 'LIABILITY', amount: '90000.00' },
  ],
  equity: [
    { accountId: 'e1', code: '3000', name: 'Share Capital', accountType: 'EQUITY', amount: '250000.00' },
    // The brought-forward balance lives here too — it is an ordinary account row, which is exactly
    // why the line below it has to say it is already counted.
    { accountId: 'e2', code: '3200', name: 'Retained Earnings', accountType: 'EQUITY', amount: broughtForward },
  ],
  assetsTotal: '540000.00',
  liabilitiesTotal: '90000.00',
  equityTotal: '250000.00',
  retainedEarnings: '17000.00',
  retainedEarningsBroughtForward: broughtForward,
  liabilitiesEquityTotal: '540000.00',
  balanced: true,
});

async function mount(broughtForward: string) {
  const w = await mountView(BalanceSheetReport, {
    path: '/reports/balance-sheet',
    routeName: 'report-balance-sheet',
    permissions: ['GL_VIEW'],
    initialState: { financialReports: { balanceSheet: sheet(broughtForward) } },
  });
  await flushPromises();
  return w;
}

/**
 * Asserted per line, not over the whole page text. The brought-forward amount is ALSO the equity
 * table's Retained Earnings row, so a page-wide `toContain` is green on a screen that never renders
 * the new line at all; and `'0.00'` is a substring of `'540,000.00'`, so counting occurrences is no
 * better. The two figures are addressed by test id and read individually.
 */
const brought = (w: Awaited<ReturnType<typeof mount>>) => w.find('[data-testid="retained-brought-forward"]');
const current = (w: Awaited<ReturnType<typeof mount>>) => w.find('[data-testid="retained-current-period"]');

describe('BalanceSheetReport', () => {
  it('shows brought forward and the current period as separate figures', async () => {
    const w = await mount('183000.00');
    // Both formatted at the base currency's decimal places (THB, 2).
    expect(brought(w).text()).toContain('183,000.00');
    expect(current(w).text()).toContain('17,000.00');
    // Not the same number rendered twice.
    expect(brought(w).text()).not.toContain('17,000.00');
  });

  it('marks brought forward as already counted in the equity rows above', async () => {
    // The one thing standing between the reader and a total that is off by 183,000. Read the marker
    // through i18n rather than hardcoding it — the app's default locale is `la`, not `en`.
    const marker = i18n.global.t('reports.balanceSheet.includedAbove');
    const w = await mount('183000.00');
    expect(brought(w).text()).toContain(marker);
    expect(current(w).text()).not.toContain(marker);
  });

  it('renders a zero brought forward rather than hiding the line', async () => {
    // A company that has never closed a year. Hiding the line would make its later appearance look
    // like a number arriving from nowhere.
    const w = await mount('0.00');
    expect(brought(w).exists()).toBe(true);
    expect(brought(w).text()).toContain('0.00');
  });

  it('takes the reported total from the server without recomputing it', async () => {
    // 540,000 = liabilities 90,000 + equity 250,000 + brought forward 183,000 + current 17,000.
    // If the screen ever adds brought forward a second time this stays green and the TOTAL moves,
    // so assert the total the server sent is the total rendered.
    const w = await mount('183000.00');
    expect(w.text()).toContain('540,000.00');
    expect(w.findComponent({ name: 'Tag' }).props('severity')).toBe('success');
  });
});
