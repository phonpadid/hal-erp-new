import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../test/mountView';
import TaxSummaryView from './TaxSummaryView.vue';
import { useTaxCodesStore } from '../stores/taxCodes';
import type { VueWrapper } from '@vue/test-utils';

/** Raw decimal strings, as the server sends them — unformatted on purpose. */
const SUMMARY = [
  { period: '2026-07', vat: '1000', wht: '3000.5' },
  { period: '2026-08', vat: '250', wht: '0' },
];

const FILED = [
  { id: 'r-1', periodFrom: '2026-07-01', periodTo: '2026-07-31', inputVat: '1000', filedOn: '2026-08-10' },
];

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

async function mount(opts: { permissions?: string[]; summary?: typeof SUMMARY; returns?: typeof FILED } = {}) {
  const w = await mountView(TaxSummaryView, {
    path: '/tax-summary',
    routeName: 'tax-summary',
    permissions: opts.permissions ?? ['TAX_VIEW'],
    initialState: {
      taxCodes: { vatSummary: opts.summary ?? SUMMARY, vatReturns: opts.returns ?? FILED },
    },
  });
  await flushPromises();
  wrapper = w;
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

  it('marks a filed month as filed and leaves the others open', async () => {
    const w = await mount();
    expect(w.findAll('[data-testid="filed-tag"]')).toHaveLength(1);
    expect(w.findAll('[data-testid="not-filed"]')).toHaveLength(1);
  });

  it('offers the file control only for the months not yet filed', async () => {
    // July is filed; only August may be claimed. A control on a filed month is an invitation to
    // credit VAT_INPUT twice for one claim.
    const w = await mount({ permissions: ['TAX_VIEW', 'VAT_FILE'] });
    expect(w.findAll('[data-testid="file-return"]')).toHaveLength(1);
  });

  it('hides the file control from someone who may only read the summary', async () => {
    const w = await mount({ permissions: ['TAX_VIEW'] });
    expect(w.find('[data-testid="file-return"]').exists()).toBe(false);
  });

  it('disables the control for a month with nothing to claim', async () => {
    const w = await mount({
      permissions: ['TAX_VIEW', 'VAT_FILE'],
      summary: [{ period: '2026-09', vat: '0', wht: '400' }],
      returns: [],
    });
    const button = w.find('[data-testid="file-return"]');
    expect((button.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('files the whole calendar month, not the day it was clicked', async () => {
    // February is the case a naive `${period}-30` gets wrong, and 2026 is not a leap year.
    const w = await mount({
      permissions: ['TAX_VIEW', 'VAT_FILE'],
      summary: [{ period: '2026-02', vat: '900', wht: '0' }],
      returns: [],
    });
    const store = useTaxCodesStore();
    vi.mocked(store.fileVatReturn).mockResolvedValue(true);

    await w.find('[data-testid="file-return"]').trigger('click');
    await flushPromises();

    const dto = vi.mocked(store.fileVatReturn).mock.calls[0][0];
    expect(dto.periodFrom).toBe('2026-02-01');
    expect(dto.periodTo).toBe('2026-02-28');
    // The id travels with the request so a retry over a slow connection is one filing.
    expect(dto.returnId).toBeTruthy();
  });
});
