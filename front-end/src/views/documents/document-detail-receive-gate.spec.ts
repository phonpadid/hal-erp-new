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

const PERMS = ['DOC_VIEW', 'DOC_RECEIVE'];

async function mount(documentType: Record<string, unknown>) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: { id: 'doc-1', docNo: 'D-1', status: 'APPROVED', currency: { code: 'LAK', decimalPlaces: 0 }, documentType },
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues: [], attachments: [], refDocument: null, successors: [],
        lines: [{ id: 'l1', lineNo: 1, description: 'Water', qty: '40', unitPrice: '68000', lineAmount: '2720000', receivedQty: '0' }],
        approvalLog: [], canAct: false, sla: null, pendingApprovers: null, matching: null,
        budgetMovements: [], loading: false, error: '',
      },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      currency: { currencies: [{ code: 'LAK', decimalPlaces: 0 }] },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const receiveButton = (w: VueWrapper) =>
  w.findAllComponents({ name: 'Button' }).find((b) => b.props('icon') === 'pi pi-inbox');

/**
 * The receive-goods action used to be offered on every approved document with lines — a PR, a
 * claim — so receipts landed on documents the matching never reads. It now follows the type.
 */
describe('document detail: receive goods follows the type', () => {
  it('offers receiving on a type that receives goods', async () => {
    const w = await mount({ id: 't-po', code: 'PO', name: 'Purchase Order', receivesGoods: true });
    expect(receiveButton(w)).toBeDefined();
  });

  it('does not offer receiving on a type that does not', async () => {
    const w = await mount({ id: 't-pr', code: 'PR', name: 'Purchase Request', receivesGoods: false });
    expect(receiveButton(w)).toBeUndefined();
  });

  it('treats an older server that sends no flag as not receiving', async () => {
    const w = await mount({ id: 't-pr', code: 'PR', name: 'Purchase Request' });
    expect(receiveButton(w)).toBeUndefined();
  });
});
