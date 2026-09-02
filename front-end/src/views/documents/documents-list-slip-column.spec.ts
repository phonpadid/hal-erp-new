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

const PERMS = ['DOC_VIEW', 'PAYMENT_VIEW'];

/**
 * The transfer-slip column answers "is this document's transfer evidenced".
 *
 * It used to ask only about COMPLETED documents, because a slip could only exist after a payment,
 * which could only exist after full approval. A slip can now be attached DURING approval to satisfy
 * a step that demands one — so a list that still asked only about completed rows would show a dash
 * for a document whose evidence is already stored.
 */
/**
 * Mounted with an EMPTY list, which is then filled — the column's read hangs off a watcher on
 * `docs.list`, and a watcher does not fire for state that was already there when it was created.
 * Seeding the rows up front therefore mounts a list nobody ever asked the slip status for, which is
 * not how the view is ever used: the rows arrive from a fetch.
 */
async function mount(rows: Array<{ id: string; status: string }>) {
  const w = await mountView(MyDocumentsView, {
    path: '/documents',
    routeName: 'documents',
    permissions: PERMS,
    initialState: {
      documents: {
        list: [],
        total: rows.length,
        page: 1,
        limit: 20,
        filters: {},
        typeOptions: { status: 'loaded', items: [] },
        loading: false,
        error: '',
      },
      masterData: { vendors: [], vendorsStatus: 'loaded', loading: false, error: '' },
      // `mountView` spreads initialState over its own auth defaults, so an auth override has to
      // carry `permissions` too or it silently un-grants everything the mount just granted.
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  const store = useDocumentsStore();
  store.list = rows.map((r) => ({ ...r, docNo: `D-${r.id}`, documentType: { name: 'Memo' } })) as never;
  await flushPromises();
  return w;
}

describe('documents list: the transfer-slip column', () => {
  let statusSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    statusSpy = vi.spyOn(paymentsApi, 'slipStatus').mockResolvedValue({});
  });

  it('asks about every visible row, not only the completed ones', async () => {
    await mount([
      { id: 'a', status: 'COMPLETED' },
      { id: 'b', status: 'IN_APPROVAL' },
    ]);
    expect(statusSpy).toHaveBeenCalledWith(['a', 'b']);
  });

  it('reads UPLOADED for a document evidenced while still in approval', async () => {
    statusSpy.mockResolvedValue({ b: 'UPLOADED' });
    const w = await mount([{ id: 'b', status: 'IN_APPROVAL' }]);
    await flushPromises();
    expect(w.find('[data-testid="slip-uploaded"]').exists()).toBe(true);
    expect(w.find('[data-testid="slip-pending"]').exists()).toBe(false);
  });

  it('reads PENDING for a payable the server says has no evidence', async () => {
    statusSpy.mockResolvedValue({ a: 'PENDING' });
    const w = await mount([{ id: 'a', status: 'COMPLETED' }]);
    await flushPromises();
    expect(w.find('[data-testid="slip-pending"]').exists()).toBe(true);
    expect(w.find('[data-testid="slip-uploaded"]').exists()).toBe(false);
  });

  it('shows neither state for a document the server had no answer for', async () => {
    // A document the company does not owe and has never evidenced is simply absent from the map.
    statusSpy.mockResolvedValue({});
    const w = await mount([{ id: 'c', status: 'DRAFT' }]);
    await flushPromises();
    expect(w.find('[data-testid="slip-uploaded"]').exists()).toBe(false);
    expect(w.find('[data-testid="slip-pending"]').exists()).toBe(false);
  });

  it('asks nothing at all without PAYMENT_VIEW', async () => {
    const w = await mountView(MyDocumentsView, {
      path: '/documents',
      routeName: 'documents',
      permissions: ['DOC_VIEW'],
      initialState: {
        documents: {
          list: [], total: 1, page: 1, limit: 20, filters: {}, typeOptions: { status: 'loaded', items: [] },
          loading: false, error: '',
        },
        masterData: { vendors: [], vendorsStatus: 'loaded', loading: false, error: '' },
        auth: { permissions: ['DOC_VIEW'], baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      },
    });
    await flushPromises();
    wrapper = w;
    const store = useDocumentsStore();
    store.list = [{ id: 'a', docNo: 'D-a', status: 'COMPLETED', documentType: { name: 'Memo' } }] as never;
    await flushPromises();
    expect(statusSpy).not.toHaveBeenCalled();
  });
});
