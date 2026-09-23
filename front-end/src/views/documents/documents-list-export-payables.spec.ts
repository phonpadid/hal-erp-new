import { flushPromises } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import { documentsApi } from '../../api/documents';
import * as documents from '../../api/documents';
import { mountView } from '../../test/mountView';
import MyDocumentsView from './MyDocumentsView.vue';

const toastAdd = vi.fn();
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: (...a: unknown[]) => toastAdd(...a) }) }));

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.restoreAllMocks();
  toastAdd.mockReset();
});

const emptyDocuments = {
  list: [], total: 0, page: 1, limit: 20, filters: {},
  typeOptions: { status: 'loaded', items: [] }, loading: false, error: '',
};

async function mount(permissions = ['DOC_VIEW']) {
  const w = await mountView(MyDocumentsView, {
    path: '/documents',
    routeName: 'documents',
    permissions,
    initialState: {
      documents: emptyDocuments,
      masterData: { vendors: [], vendorsStatus: 'loaded', loading: false, error: '' },
      auth: { permissions, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const button = (w: VueWrapper) => w.find('[data-testid="export-payables"]');

/**
 * Finance's payables sheet is the list, whole, as an .xlsx — so the button sends exactly the
 * filter bar's values and no page window, and an empty status filter sends no `status` at all,
 * leaving the server to export the pending set.
 */
describe('documents list: export payables', () => {
  it('is offered to a DOC_VIEW reader and absent otherwise', async () => {
    expect(button(await mount(['DOC_VIEW'])).exists()).toBe(true);
    wrapper?.unmount();
    expect(button(await mount(['DOC_CREATE'])).exists()).toBe(false);
  });

  it('requests the export with the current filters and no page parameters, then downloads it', async () => {
    const w = await mount();
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'content-disposition': 'attachment; filename="payables-HAL-2026-09-18.xlsx"' },
    } as never);
    const download = vi.spyOn(documents, 'downloadBlob').mockImplementation(() => undefined);

    await button(w).trigger('click');
    await flushPromises();

    const call = get.mock.calls.find((c) => c[0] === '/documents/export/payables.xlsx');
    expect(call).toBeDefined();
    const params = (call![1] as { params: Record<string, unknown>; responseType: string }).params;
    expect(params).not.toHaveProperty('page');
    expect(params).not.toHaveProperty('limit');
    // No status chosen: none sent, so the server's pending default applies.
    expect(params).not.toHaveProperty('status');
    expect((call![1] as { responseType: string }).responseType).toBe('blob');
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'payables-HAL-2026-09-18.xlsx');
  });

  it('sends the chosen status and department as the list would', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: new Blob(['x']), headers: {} } as never);
    await documentsApi.exportPayables({ status: ['IN_APPROVAL'], departmentId: 'd1' });
    const [, opts] = get.mock.calls[0];
    expect((opts as { params: Record<string, string> }).params).toEqual({ status: 'IN_APPROVAL', departmentId: 'd1' });
  });

  it('falls back to a plain file name when the server names none', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: new Blob(['x']), headers: {} } as never);
    expect((await documentsApi.exportPayables()).fileName).toBe('payables.xlsx');
  });

  it('reports a failed export and re-enables the button', async () => {
    const w = await mount();
    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'));

    await button(w).trigger('click');
    await flushPromises();

    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    expect(button(w).attributes('disabled')).toBeUndefined();
  });
});
