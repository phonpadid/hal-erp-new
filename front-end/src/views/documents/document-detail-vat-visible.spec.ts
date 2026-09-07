import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import DocumentDetailView from './DocumentDetailView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const PERMS = ['DOC_VIEW'];
const LINE = { lineNo: 1, description: 'x', qty: '1', unitPrice: '10.00', lineAmount: '10.00' };

async function mount(over: Record<string, unknown> = {}) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: {
          id: 'doc-1', docNo: 'D-1', status: 'IN_APPROVAL',
          currency: { code: 'USD', decimalPlaces: 2 },
          ...over,
        },
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues: [], lines: [LINE], attachments: [], refDocument: null,
        approvalLog: [], canAct: false, sla: null, pendingApprovers: null, matching: null,
        loading: false, error: '',
      },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      currency: { currencies: [{ code: 'USD', decimalPlaces: 2 }, { code: 'LAK', decimalPlaces: 0 }] },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

/**
 * What a document costs is the tax-inclusive figure. The headline used to show the summed line
 * amounts under the word "total", so every VAT-bearing document was understated by the tax — a
 * document costing 11.00 read as 10.00, and nothing on the page said where the other 1.00 went.
 */
describe('document detail: the price includes the tax', () => {
  const TAXED = { subTotal: '10.00', taxTotal: '1.00', grandTotal: '11.00' };

  it('headlines the tax-inclusive total, not the line sum', async () => {
    const w = await mount(TAXED);
    const text = w.text();
    expect(text).toContain('11.00');
  });

  it('breaks the total into before-tax and VAT', async () => {
    const w = await mount(TAXED);
    const text = w.text();
    // Both components readable, so the headline reconciles to the line items.
    expect(text).toContain('10.00');
    expect(text).toContain('1.00');
  });

  it('shows the tax beside the line-items sum', async () => {
    const w = await mount(TAXED);
    const note = w.find('[data-testid="lines-with-tax"]');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain('11.00');
  });

  it('says nothing about tax on a document that carries none', async () => {
    // A VAT row of zero is noise on the many documents that have no tax at all.
    const w = await mount({ subTotal: '10.00', taxTotal: '0', grandTotal: '10.00' });
    expect(w.find('[data-testid="lines-with-tax"]').exists()).toBe(false);
  });
});
