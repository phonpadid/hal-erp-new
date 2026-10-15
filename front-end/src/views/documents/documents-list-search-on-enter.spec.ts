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
 * The list searches on Enter, not on every keystroke.
 *
 * Each keystroke was a full list read — the server searches the whole set, not the page — and a
 * term typed in four strokes cost four of them while the person was still typing. The same rule
 * the approval inbox follows (`PageToolbar`'s `submitOnEnter`): the request goes when the term is
 * complete, and emptying the box is itself the request to see everything again.
 */
describe('documents list: search on Enter', () => {
  beforeEach(() => {
    vi.spyOn(paymentsApi, 'slipStatus').mockResolvedValue({});
  });

  it('reads the list once, on Enter, with the whole term — and at once when the box is emptied', async () => {
    const w = await mountView(MyDocumentsView, {
      path: '/documents',
      routeName: 'documents',
      permissions: PERMS,
      initialState: {
        documents: {
          list: [], total: 0, page: 1, limit: 20, filters: {},
          typeOptions: { status: 'loaded', items: [] }, loading: false, error: '',
        },
        masterData: { vendors: [], vendorsStatus: 'loaded', loading: false, error: '' },
        auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      },
    });
    await flushPromises();
    wrapper = w;
    const store = useDocumentsStore();
    const applied = vi.spyOn(store, 'applyFilters').mockResolvedValue(undefined as never);

    const input = w.find('input');
    for (const typed of ['0', '00', '005', '0005']) await input.setValue(typed);
    await flushPromises();
    expect(applied).not.toHaveBeenCalled();

    await input.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied.mock.calls[0][0]).toMatchObject({ docNo: '0005' });

    await input.setValue('');
    await flushPromises();
    expect(applied).toHaveBeenCalledTimes(2);
    expect(applied.mock.calls[1][0].docNo).toBeUndefined();
  });
});
