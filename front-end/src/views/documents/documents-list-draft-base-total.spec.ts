import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import MyDocumentsView from './MyDocumentsView.vue';
import { paymentsApi } from '../../api/payments';
import { useDocumentsStore } from '../../stores/documents';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
});

const PERMS = ['DOC_VIEW'];

/**
 * The base-currency column states a figure a submit computed, so a DRAFT row has none to state.
 *
 * `base_total_amount` is written only at submit. A draft's is either absent, or left behind by a
 * submission that the return putting it back in DRAFT withdrew — which is how a draft corrected
 * from kip to baht came to show its old kip figure under the new currency.
 */
async function mount(rows: Array<Record<string, unknown>>) {
  const w = await mountView(MyDocumentsView, {
    path: '/documents',
    routeName: 'documents',
    permissions: PERMS,
    initialState: {
      documents: {
        list: [], total: rows.length, page: 1, limit: 20, filters: {},
        typeOptions: { status: 'loaded', items: [] }, loading: false, error: '',
      },
      masterData: { vendors: [], vendorsStatus: 'loaded', loading: false, error: '' },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  const store = useDocumentsStore();
  store.list = rows.map((r) => ({ ...r, documentType: { name: 'Memo' } })) as never;
  await flushPromises();
  return w;
}

describe('documents list: the base-currency column on a draft', () => {
  beforeEach(() => {
    vi.spyOn(paymentsApi, 'slipStatus').mockResolvedValue({});
  });

  it('states no base total for a draft that carries a withdrawn one', async () => {
    const w = await mount([
      { id: 'a', docNo: 'REC-HAL-2026-0026', status: 'DRAFT', baseTotalAmount: '42000.00' },
    ]);

    expect(w.text()).not.toMatch(/42,000/);
  });

  it('states it for a document that has left DRAFT', async () => {
    // The regression guard: the column exists for these rows.
    const w = await mount([
      { id: 'b', docNo: 'D-2', status: 'IN_APPROVAL', baseTotalAmount: '28980000.00' },
    ]);

    expect(w.text()).toMatch(/28,980,000/);
  });
});
