import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../test/mountView';
import TaxSummaryView from './TaxSummaryView.vue';

/** Raw decimal strings, as the server sends them — unformatted on purpose. */
const SUMMARY = [
  { period: '2026-07', vat: '1000', wht: '3000.5' },
];

async function mount() {
  const w = await mountView(TaxSummaryView, {
    path: '/tax-summary',
    routeName: 'tax-summary',
    permissions: ['TAX_VIEW'],
    initialState: { taxCodes: { vatSummary: SUMMARY } },
  });
  await flushPromises();
  return w;
}

describe('TaxSummaryView', () => {
  it('formats the figures at the base currency decimal places', async () => {
    // These are numbers a person copies onto a tax return; `1000` and `1,000.00` are not
    // interchangeable there.
    const w = await mount();
    expect(w.find('[data-testid="summary-vat"]').text()).toBe('1,000.00');
    expect(w.find('[data-testid="summary-wht"]').text()).toBe('3,000.50');
  });
});
