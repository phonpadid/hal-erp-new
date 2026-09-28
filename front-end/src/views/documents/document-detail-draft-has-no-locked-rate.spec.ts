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
const LINE = { lineNo: 1, description: 'x', qty: '3', unitPrice: '14000.00', lineAmount: '42000.00' };

/**
 * What a draft may claim about a locked exchange rate: nothing.
 *
 * `exchange_rate` and `base_total_amount` are written only at submit, and `exchange_rate` defaults
 * to 1 from creation. So on a DRAFT they have either never been computed or they belong to a
 * submission that the return putting it back in DRAFT withdrew.
 *
 * It did not matter until a draft's currency became correctable: before that the stamp always
 * belonged to the currency the document named, because the currency could not change. REC-HAL-2026-
 * 0026 is the shape that broke it — a rent claim raised in kip, returned four times for a wrong
 * amount, corrected to baht, and then showing `1.00` and `42,000 LAK` beside `42,000.00 THB`. A 1:1
 * conversion off by nearly three orders of magnitude, shown to the author who had just made the
 * correction and was reading the screen to see whether it took.
 */
async function mount(over: Record<string, unknown> = {}) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: {
          id: 'doc-1', docNo: 'REC-HAL-2026-0026', status: 'DRAFT',
          currency: { code: 'THB', decimalPlaces: 2 },
          // The stamp the last submit left behind, while the document was still in the base
          // currency: identity rate, and a base total equal to the document total.
          exchangeRate: '1.00000000',
          baseTotalAmount: '42000.00',
          grandTotal: '42000.00',
          submittedAt: '2026-09-25T07:47:00.000Z',
          ...over,
        },
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues: [], lines: [LINE], attachments: [], refDocument: null,
        approvalLog: [], canAct: false, sla: null, pendingApprovers: null, matching: null,
        loading: false, error: '',
      },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      currency: { currencies: [{ code: 'THB', decimalPlaces: 2 }, { code: 'LAK', decimalPlaces: 0 }] },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe("a draft claims no locked rate", () => {
  it('shows neither the stamped rate nor the stamped base total', async () => {
    const w = await mount();
    const text = w.text();

    // The rate tile said "1.00" next to a THB document.
    expect(text).not.toContain('1.00000000');
    // The base total tile said 42,000 LAK for a document worth ~28,980,000.
    expect(text).not.toMatch(/42,000\s*LAK/);
  });

  it('does not date a lock the document no longer has', async () => {
    // `submittedAt` survives the return, so it alone would keep dating a withdrawn stamp.
    // Asserted on the LABEL, not on a year: '2026' also appears in the doc_no.
    const w = await mount();

    expect(w.text()).not.toContain('ລັອກອັດຕາເມື່ອ');
  });

  it('dates the lock once the document has been submitted', async () => {
    const w = await mount({ status: 'IN_APPROVAL', exchangeRate: '690.00000000', baseTotalAmount: '28980000.00' });

    expect(w.text()).toContain('ລັອກອັດຕາເມື່ອ');
  });

  it('still shows the document total in its own currency', async () => {
    // The live figure is not in question; only the base-currency claim is withheld.
    const w = await mount();

    expect(w.text()).toMatch(/42,000\.00/);
  });

  it('shows both again once the document has been submitted', async () => {
    // The regression guard: the fix is a condition, and an over-broad one would hide these
    // everywhere, including on the approval screens that are the whole reason they exist.
    const w = await mount({
      status: 'IN_APPROVAL',
      exchangeRate: '690.00000000',
      baseTotalAmount: '28980000.00',
    });
    const text = w.text();

    expect(text).toMatch(/28,980,000/);
    expect(text).toMatch(/690/);
  });
});
