import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import InputNumber from 'primevue/inputnumber';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { CreatableType } from '../../api/documents';
import DocumentTypePicker from './DocumentTypePicker.vue';
import LineItemsEditor, { type EditorLine } from './LineItemsEditor.vue';

const global = {
  plugins: [createTestingPinia({ createSpy: vi.fn }), i18n, PrimeVue],
};

const TYPES: CreatableType[] = [
  { id: 't1', code: 'PR', name: 'Purchase Request', category: 'PROCUREMENT', requiresBudget: true, requiresQuota: false, requiresVendor: true, requiresItem: true, requiresPayee: false },
  { id: 't2', code: 'LV', name: 'Leave Request', category: 'HR', requiresBudget: false, requiresQuota: true, requiresVendor: false, requiresItem: false, requiresPayee: false },
];

describe('DocumentTypePicker', () => {
  it('renders a radiogroup of keyboard-operable type cards', () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: '', types: TYPES }, global });
    expect(w.find('[role="radiogroup"]').exists()).toBe(true);
    const radios = w.findAll('[role="radio"]');
    expect(radios).toHaveLength(2);
    // Cards are native <button>s, so they are focusable and activate on Enter/Space.
    expect(radios[0].element.tagName).toBe('BUTTON');
  });

  it('selects a type on click and exposes aria-checked', async () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: '', types: TYPES }, global });
    await w.findAll('[role="radio"]')[1].trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['t2']);
  });

  it('shows a skeleton while loading and no cards', () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: '', types: [], loading: true }, global });
    expect(w.findComponent({ name: 'Skeleton' }).exists()).toBe(true);
    expect(w.findAll('[role="radio"]')).toHaveLength(0);
  });

  it('does not change selection when disabled (edit mode)', async () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: 't1', types: TYPES, disabled: true }, global });
    await w.findAll('[role="radio"]')[1].trigger('click');
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });

  it('tells the user when no type is available to create', () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: '', types: [] }, global });
    expect(w.find('[data-testid="no-types"]').exists()).toBe(true);
    expect(w.find('[role="radiogroup"]').exists()).toBe(false);
  });

  // ARIA radiogroup: one tab stop for the whole group, moved by the arrow keys.
  it('exposes a single tab stop, on the selected card', () => {
    const unset = mount(DocumentTypePicker, { props: { modelValue: '', types: TYPES }, global });
    // Nothing selected yet → the first card is the tab stop, so Tab still enters the group.
    expect(unset.findAll('[role="radio"]').map((r) => r.attributes('tabindex'))).toEqual(['0', '-1']);

    const w = mount(DocumentTypePicker, { props: { modelValue: 't2', types: TYPES }, global });
    expect(w.findAll('[role="radio"]').map((r) => r.attributes('tabindex'))).toEqual(['-1', '0']);
  });

  it('moves selection with the arrow keys, wrapping at the ends', async () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: 't1', types: TYPES }, global });
    const radios = w.findAll('[role="radio"]');
    await radios[0].trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['t2']);
    // Wraps from the last card back to the first.
    await radios[1].trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['t1']);
    await radios[0].trigger('keydown', { key: 'ArrowLeft' });
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['t2']);
  });

  it('jumps to the first and last card with Home and End', async () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: 't1', types: TYPES }, global });
    const radios = w.findAll('[role="radio"]');
    await radios[0].trigger('keydown', { key: 'End' });
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['t2']);
    await radios[1].trigger('keydown', { key: 'Home' });
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['t1']);
  });

  it('ignores arrow keys when disabled (edit mode)', async () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: 't1', types: TYPES, disabled: true }, global });
    await w.findAll('[role="radio"]')[0].trigger('keydown', { key: 'ArrowRight' });
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });
});

describe('LineItemsEditor', () => {
  const mountEditor = (lines: EditorLine[]) =>
    mount(LineItemsEditor, {
      props: { modelValue: lines, currency: 'THB', items: [], budgets: [], canMaster: false, canBudget: false },
      global,
    });

  it('shows the empty state with an add-first-line affordance', () => {
    const w = mountEditor([]);
    expect(w.text()).toContain('ຍັງບໍ່ມີລາຍການ'); // la: "No line items yet."
    expect(w.findComponent({ name: 'Button' }).exists()).toBe(true);
  });

  it('computes the per-line amount from string math', () => {
    const w = mountEditor([{ description: 'x', qty: '2', unitPrice: '10.50' }]);
    expect(w.text()).toContain('21.00'); // 2 × 10.50, formatted to 2 dp
  });

  it('keeps money a string when InputNumber emits a number', async () => {
    const lines: EditorLine[] = [{ description: 'x', qty: '1', unitPrice: '0' }];
    const w = mountEditor(lines);
    const numbers = w.findAllComponents(InputNumber);
    // unit price is the second InputNumber (qty is first); emit a numeric update.
    await numbers[1].vm.$emit('update:modelValue', 12.5);
    expect(lines[0].unitPrice).toBe('12.5');
    expect(typeof lines[0].unitPrice).toBe('string');
  });

  it('flags an invalid line with an error associated to the input', () => {
    const w = mountEditor([{ description: 'x', qty: '-1', unitPrice: '5' }]);
    const msg = w.find('#line-err-0');
    expect(msg.exists()).toBe(true);
    expect(w.find('[aria-describedby="line-err-0"]').exists()).toBe(true);
  });

  // Budget affordances render only for a requires_budget type (DOC_CREATE is implied); the
  // options carry no amounts.
  const BUDGETS = [
    { id: 'b1', budgetName: 'IT 2026', glAccount: '5000' },
    { id: 'b2', budgetName: 'Ops 2026', glAccount: '5100' },
  ];
  const mountWithBudget = (lines: EditorLine[]) =>
    mount(LineItemsEditor, {
      props: { modelValue: lines, currency: 'THB', items: [], budgets: BUDGETS, canMaster: false, canBudget: true, requiresBudget: true },
      global,
    });

  it('shows the per-line budget picker on a requires_budget type', () => {
    const w = mountWithBudget([{ description: 'x', qty: '1', unitPrice: '0' }]);
    expect(w.text()).toContain('ງົບປະມານ'); // la: "Budget" column header
  });

  it('does not render the budget picker when the type is not budget-controlled', () => {
    // canBudget=true but requiresBudget=false → no budget control (gated on the type, not the permission).
    const w = mount(LineItemsEditor, {
      props: { modelValue: [{ description: 'x', qty: '1', unitPrice: '0' }], currency: 'THB', items: [], budgets: BUDGETS, canMaster: false, canBudget: true, requiresBudget: false },
      global,
    });
    expect(w.text()).not.toContain('ງົບປະມານ');
  });

  it('labels a chosen budget by name with the GL in parentheses, and shows no amount', () => {
    const w = mountWithBudget([{ description: 'x', qty: '1', unitPrice: '0', budgetId: 'b1' }]);
    // The picker labels a budget as "name (GL)" — a fund name, not a raw GL code — and never a
    // money figure. (Budgets without a name fall back to the GL alone.)
    expect(w.text()).toContain('IT 2026');
    expect(w.text()).toContain('5000');
    expect(w.text()).not.toContain('amountTotal');
  });

  // requires_item: the item is required and an item-less line is flagged (mirrors the server).
  const ITEMS = [{ id: 'it1', name: 'Electricity', defaultGlAccount: '5210', isActive: true }] as never;

  it('flags an item-less line and marks the item required on a requires_item type', () => {
    const w = mount(LineItemsEditor, {
      props: { modelValue: [{ description: 'x', qty: '1', unitPrice: '10' }], currency: 'THB', items: ITEMS, budgets: [], canMaster: true, canBudget: false, requiresItem: true },
      global,
    });
    expect(w.text()).toContain('ແຖວນີ້ຕ້ອງມີສິນຄ້າ'); // la: "An item is required on this line."
  });

  it('does not flag the item when requires_item is false', () => {
    const w = mount(LineItemsEditor, {
      props: { modelValue: [{ description: 'x', qty: '1', unitPrice: '10' }], currency: 'THB', items: ITEMS, budgets: [], canMaster: true, canBudget: false, requiresItem: false },
      global,
    });
    expect(w.text()).not.toContain('ແຖວນີ້ຕ້ອງມີສິນຄ້າ');
  });
});
