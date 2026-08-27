import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Column from 'primevue/column';
import { FilterMatchMode } from '@primevue/core/api';
import { h } from 'vue';
import AppDataTable from './AppDataTable.vue';
import { i18n } from '../i18n';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/**
 * Three screens hold every row they will ever show — their `total` IS their array's length. For
 * those, a client-side filter is the correct answer and the only thing stopping it was `lazy`, in
 * which PrimeVue delegates filtering to the server and ignores the bindings it is given.
 *
 * `clientPaged` turns `lazy` off. These assert that the filter then reaches the rows.
 */
const ROWS = [
  { id: '1', code: 'WH-01', name: 'Central store' },
  { id: '2', code: 'WH-02', name: 'Cold store' },
  { id: '3', code: 'HQ-09', name: 'Head office' },
];

function mountTable(props: Record<string, unknown>, term: string | null) {
  const w = mount(AppDataTable, {
    props: {
      value: ROWS,
      total: ROWS.length,
      dataKey: 'id',
      filters: { global: { value: term, matchMode: FilterMatchMode.CONTAINS } },
      globalFilterFields: ['code', 'name'],
      ...props,
    },
    global: { plugins: [i18n, [PrimeVue, { theme: { preset: {} } }]] },
    slots: {
      default: () => [h(Column, { field: 'code', header: 'Code' }), h(Column, { field: 'name', header: 'Name' })],
    },
  });
  wrapper = w;
  return w;
}

const bodyRows = (w: VueWrapper) => w.findAll('tbody tr').filter((r) => r.find('td').exists());

describe('AppDataTable clientPaged', () => {
  it('filters across every row it was given', async () => {
    const w = mountTable({ clientPaged: true }, 'store');
    await flushPromises();
    const text = bodyRows(w).map((r) => r.text());
    expect(text).toHaveLength(2);
    expect(text.join(' ')).toContain('WH-01');
    expect(text.join(' ')).toContain('WH-02');
    expect(text.join(' ')).not.toContain('HQ-09');
  });

  it('empties the table for a term nothing matches', async () => {
    const w = mountTable({ clientPaged: true }, 'zzz-no-such-warehouse');
    await flushPromises();
    // One row remains — the empty-state placeholder. None of the data reaches the table.
    const text = bodyRows(w).map((r) => r.text()).join(' ');
    for (const row of ROWS) expect(text).not.toContain(row.code);
  });

  it('shows every row again when the box is cleared', async () => {
    const w = mountTable({ clientPaged: true }, null);
    await flushPromises();
    expect(bodyRows(w)).toHaveLength(3);
  });

  it('pages the rows it holds rather than showing all of them at once', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ id: String(i), code: `WH-${i}`, name: `Store ${i}` }));
    const w = mount(AppDataTable, {
      props: { value: many, total: many.length, dataKey: 'id', clientPaged: true, rows: 20 },
      global: { plugins: [i18n, [PrimeVue, { theme: { preset: {} } }]] },
      slots: { default: () => [h(Column, { field: 'code', header: 'Code' })] },
    });
    wrapper = w;
    await flushPromises();
    // A caller that used to bind `rows` to its own array length was telling a LAZY table
    // "one page, show everything". Off `lazy` that is a page of forty-five, a rows-per-page
    // control with no matching option, and no pager — which is what shipped on the control
    // points screen. The default page size is the right answer for a client-paged table.
    expect(bodyRows(w)).toHaveLength(20);
  });

  it('a server-paged caller keeps its own page count — clientPaged would throw it away', async () => {
    // The RbacAdminView users table shipped with `clientPaged` while holding ONE page of 85
    // accounts. Off `lazy`, PrimeVue counts pages from `value.length`, so the pager collapsed to a
    // single page and 65 users became unreachable. A server-paged table must stay lazy.
    const onePage = Array.from({ length: 20 }, (_, i) => ({ id: String(i), code: `U-${i}`, name: `User ${i}` }));
    const w = mount(AppDataTable, {
      props: { value: onePage, total: 85, rows: 20, page: 1, dataKey: 'id' },
      global: { plugins: [i18n, [PrimeVue, { theme: { preset: {} } }]] },
      slots: { default: () => [h(Column, { field: 'code', header: 'Code' })] },
    });
    wrapper = w;
    await flushPromises();
    const pages = w.findAll('.p-paginator-page');
    // 85 rows at 20 a page is five pages, and the reader must be able to reach all of them.
    expect(pages.length).toBeGreaterThan(1);
  });

  it('does not warn about the filter bindings it now honors', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountTable({ clientPaged: true }, 'store');
    await flushPromises();
    expect(err.mock.calls.flat().join(' ')).not.toContain('[AppDataTable]');
    err.mockRestore();
  });

  it('warns when clientPaged is set on a table whose total is not its own row count', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onePage = Array.from({ length: 20 }, (_, i) => ({ id: String(i), code: `U-${i}`, name: `User ${i}` }));
    const w = mount(AppDataTable, {
      // The exact shape of the RBAC users bug: one server page, a server total.
      props: { value: onePage, total: 85, rows: 20, page: 1, dataKey: 'id', clientPaged: true },
      global: { plugins: [i18n, [PrimeVue, { theme: { preset: {} } }]] },
      slots: { default: () => [h(Column, { field: 'code', header: 'Code' })] },
    });
    wrapper = w;
    await flushPromises();
    const said = err.mock.calls.flat().join(' ');
    expect(said).toContain('clientPaged is set');
    expect(said).toContain('SERVER-paged');
    err.mockRestore();
  });

  it('says nothing when clientPaged holds every row it counts', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountTable({ clientPaged: true }, null);
    await flushPromises();
    // ROWS.length === total, which is the whole licence for clientPaged.
    expect(err.mock.calls.flat().join(' ')).not.toContain('clientPaged is set');
    err.mockRestore();
  });

  it('still warns when a lazy table is handed a filter it will ignore', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountTable({}, 'store');
    await flushPromises();
    // The guard is the reason all fourteen dead search boxes were found; it must keep firing.
    expect(err.mock.calls.flat().join(' ')).toContain('[AppDataTable]');
    err.mockRestore();
  });
});
