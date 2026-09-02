import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import DocumentDetailView from './DocumentDetailView.vue';
import { paymentsApi } from '../../api/payments';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const PERMS = ['DOC_VIEW', 'PAYMENT_VIEW'];

/**
 * The payment-evidence panel used to find out whether a document had been paid by asking for its
 * slips and reading the 404 as the answer. Every unpaid document therefore raised a 404 nobody
 * saw, and a genuine failure of that read — a 500, a dropped connection — hid the panel of a
 * document that does have evidence, saying nothing at all.
 */
async function mount(hasPayment: boolean, over: { hasSlip?: boolean; slipRequired?: boolean } = {}) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: { id: 'doc-1', docNo: 'D-1', status: 'COMPLETED' },
        hasPayment,
        hasSlip: over.hasSlip ?? false,
        slipRequired: over.slipRequired ?? false,
        fieldValues: [], lines: [], attachments: [], refDocument: null, approvalLog: [],
        canAct: false, sla: null, pendingApprovers: null, matching: null,
        loading: false, error: '',
      },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('document detail payment evidence', () => {
  let listSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    listSpy = vi.spyOn(paymentsApi.slips, 'list').mockResolvedValue([]);
  });

  it('asks for no slips at all when the document has no payment', async () => {
    const w = await mount(false);
    expect(w.find('[data-testid="payment-slips"]').exists()).toBe(false);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('reads the slips when the document does have a payment', async () => {
    const w = await mount(true);
    expect(w.find('[data-testid="payment-slips"]').exists()).toBe(true);
    expect(listSpy).toHaveBeenCalledWith('doc-1');
  });

  it('shows a failed slips read as a failure, not as an absent panel', async () => {
    listSpy.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500 } }));
    const w = await mount(true);
    await flushPromises();
    expect(w.find('[data-testid="payment-slips"]').exists()).toBe(true);
    expect(w.find('[data-testid="slips-failed"]').exists()).toBe(true);
    expect(w.find('[data-testid="no-slips"]').exists()).toBe(false);
  });

  it('still says plainly when a paid document simply has no slip attached yet', async () => {
    const w = await mount(true);
    await flushPromises();
    expect(w.find('[data-testid="no-slips"]').exists()).toBe(true);
    expect(w.find('[data-testid="slips-failed"]').exists()).toBe(false);
  });

  it('shows the evidence of a document whose slip predates any payment', async () => {
    // A slip attached during approval is evidence of the same standing as one attached after. The
    // old rule — "completed and paid" — would have hidden it while it sat in storage.
    const w = await mount(false, { hasSlip: true });
    expect(w.find('[data-testid="payment-slips"]').exists()).toBe(true);
    expect(listSpy).toHaveBeenCalledWith('doc-1');
  });

  it('offers the panel, empty, when the current step is the one asking for a slip', async () => {
    // There is nothing to read yet; there is something to DO, which is why the panel appears.
    const w = await mount(false, { slipRequired: true });
    await flushPromises();
    expect(w.find('[data-testid="payment-slips"]').exists()).toBe(true);
    expect(w.find('[data-testid="no-slips"]').exists()).toBe(true);
  });

  it('shows nothing for a document with no payment, no slip and no requirement', async () => {
    const w = await mount(false);
    expect(w.find('[data-testid="payment-slips"]').exists()).toBe(false);
    expect(listSpy).not.toHaveBeenCalled();
  });
});
