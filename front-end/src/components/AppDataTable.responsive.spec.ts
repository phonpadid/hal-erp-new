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

/**
 * Below `md` a marked-up table stops being a grid of columns and becomes a list of cards, because
 * there is no share of a 375px viewport that nine columns can take: Lao is written without spaces,
 * so a column that narrow sets its header one character per line. The wrapper tags each cell with
 * what it is for and the stylesheet lays the card out from those tags.
 */
describe('AppDataTable mobile card layout', () => {
  function mountTagged(columns: Array<Record<string, unknown>>) {
    const w = mount(AppDataTable, {
      props: { value: [ROW], total: 1 },
      global: { plugins: [i18n, [PrimeVue, { theme: { preset: {} } }]] },
      slots: { default: () => columns.map((c) => h(Column, c)) },
    });
    wrapper = w;
    return w;
  }

  it('opts a table in only once its columns say what they are for', () => {
    const bare = mountTagged([{ field: 'docNo', header: 'ເລກທີເອກະສານ' }]);
    expect(bare.find('.app-mobile-cards').exists()).toBe(false);
    bare.unmount();

    const tagged = mountTagged([{ field: 'docNo', header: 'ເລກທີເອກະສານ', 'data-priority': 'identity' }]);
    expect(tagged.find('.app-mobile-cards').exists()).toBe(true);
  });

  it('tags the identity and action cells so the card can place them', () => {
    const w = mountTagged([
      { field: 'docNo', header: 'ເລກທີເອກະສານ', 'data-priority': 'identity' },
      { field: 'status', header: 'ສະຖານະ' },
      { field: 'approver', header: 'ການກະທຳ', 'data-priority': 'actions' },
    ]);
    const classesOf = (sel: string) => w.findAll(`td${sel}`).length;
    expect(classesOf('.app-col-identity')).toBe(1);
    expect(classesOf('.app-col-actions')).toBe(1);
    // Everything else primary is a detail cell, laid out under the identity line.
    expect(classesOf('.app-col-detail')).toBe(1);
  });

  it('gives a detail cell its own header text, because the card hides the header row', () => {
    const w = mountTagged([
      { field: 'docNo', header: 'ເລກທີເອກະສານ', 'data-priority': 'identity' },
      { field: 'status', header: 'ສະຖານະ' },
    ]);
    // The label rides down as a custom property; the stylesheet renders it with `content`.
    // Without it the card would show a bare value with nothing naming it.
    const detail = w.find('td.app-col-detail');
    expect(detail.attributes('style')).toContain('--app-col-label');
    expect(detail.attributes('style')).toContain('ສະຖານະ');
  });

  it('keeps a body style the caller already set when it adds the label', () => {
    const w = mountTagged([
      { field: 'docNo', header: 'ເລກທີເອກະສານ', 'data-priority': 'identity' },
      { field: 'status', header: 'ຍອດລວມ', bodyStyle: 'text-align:right' },
    ]);
    const style = w.find('td.app-col-detail').attributes('style');
    expect(style).toContain('text-align: right');
    expect(style).toContain('--app-col-label');
  });

  it('keeps the row ordinal off a phone, where the identifying column needs the width', () => {
    const w = mountTable([ROW]);
    const ordinal = w.findAll('th').find((h) => h.text().trim() === '#');
    expect(ordinal?.classes()).toContain('hidden');
    expect(ordinal?.classes()).toContain('md:table-cell');
  });
});
