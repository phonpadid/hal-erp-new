import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Column from 'primevue/column';
import { h } from 'vue';
import AppDataTable from './AppDataTable.vue';
import EmptyState from './EmptyState.vue';
import { i18n } from '../i18n';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/**
 * At 375px the documents list showed two of its eight columns and nothing to say the other six
 * existed. A column now declares whether a reader triages on it; the rest fold into a per-row
 * expander, and the declaration lives in one place so hiding and expanding cannot disagree.
 */
function mountTable(rows: Array<Record<string, unknown>>) {
  const w = mount(AppDataTable, {
    props: { value: rows, total: rows.length },
    global: {
      plugins: [i18n, [PrimeVue, { theme: { preset: {} } }]],
    },
    slots: {
      default: () => [
        h(Column, { field: 'docNo', header: 'ເລກທີເອກະສານ' }),
        h(Column, { field: 'status', header: 'ສະຖານະ' }),
        h(Column, { field: 'createdAt', header: 'ສ້າງເມື່ອ', 'data-priority': 'secondary' }),
        h(Column, { field: 'approver', header: 'ຜູ້ອະນຸມັດຂັ້ນຕອນຕໍ່ໄປ', 'data-priority': 'secondary' }),
      ],
      empty: () => h(EmptyState, { title: 'ຍັງບໍ່ມີເອກະສານ', message: 'ບໍ່ມີແຖວທີ່ຈະສະແດງ' }),
    },
  });
  wrapper = w;
  return w;
}

const ROW = {
  id: '1',
  docNo: 'BUDGET_PLAN-HAL-2026-0020',
  status: 'ສຳເລັດ',
  createdAt: '24-08-2026',
  approver: 'ອະນຸມັດເອກະສານສຳເລັດ',
};

describe('AppDataTable column priority', () => {
  it('hides a secondary column below md and keeps a primary one always visible', () => {
    const w = mountTable([ROW]);
    const headers = w.findAll('th');
    const created = headers.find((h) => h.text().includes('ສ້າງເມື່ອ'));
    const docNo = headers.find((h) => h.text().includes('ເລກທີເອກະສານ'));
    expect(created?.classes()).toContain('hidden');
    expect(created?.classes()).toContain('md:table-cell');
    expect(docNo?.classes() ?? []).not.toContain('hidden');
    // The body cell too — hiding a header without its column would misalign the row.
    expect(w.findAll('td').some((c) => c.classes().includes('hidden'))).toBe(true);
  });

  it('offers an expander for the columns this width cannot carry', async () => {
    const w = mountTable([ROW]);
    await flushPromises();
    const expanderHeader = w.findAll('th').find((h) => h.classes().includes('md:hidden'));
    expect(expanderHeader).toBeDefined();
  });

  it('adds no expander when every column is primary', async () => {
    const w = mount(AppDataTable, {
      props: { value: [ROW], total: 1 },
      global: { plugins: [i18n, [PrimeVue, { theme: { preset: {} } }]] },
      slots: { default: () => [h(Column, { field: 'docNo', header: 'ເລກທີເອກະສານ' })] },
    });
    wrapper = w;
    await flushPromises();
    expect(w.findAll('th').some((h) => h.classes().includes('md:hidden'))).toBe(false);
  });

  it('reaches every hidden column through the expanded row', async () => {
    const w = mountTable([ROW]);
    await flushPromises();
    const toggle = w.find('.p-datatable-row-toggle-button, button[aria-label]');
    expect(toggle.exists()).toBe(true);
    await toggle.trigger('click');
    await flushPromises();
    const text = w.text();
    // Header and value of both secondary columns, so nothing is merely hidden.
    expect(text).toContain('ສ້າງເມື່ອ');
    expect(text).toContain('24-08-2026');
    expect(text).toContain('ອະນຸມັດເອກະສານສຳເລັດ');
  });
});

describe('AppDataTable empty state', () => {
  it('renders the empty state with both its title and its message', async () => {
    const w = mountTable([]);
    await flushPromises();
    expect(w.text()).toContain('ຍັງບໍ່ມີເອກະສານ');
    expect(w.text()).toContain('ບໍ່ມີແຖວທີ່ຈະສະແດງ');
  });
});
