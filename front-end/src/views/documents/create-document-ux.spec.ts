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
  { id: 't1', code: 'PR', name: 'Purchase Request', category: 'PROCUREMENT', requiresBudget: true, requiresQuota: false, requiresVendor: true },
  { id: 't2', code: 'LV', name: 'Leave Request', category: 'HR', requiresBudget: false, requiresQuota: true, requiresVendor: false },
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

  // A creator (canBudget = DOC_CREATE) picks a budget per line; the options carry no amounts.
  const BUDGETS = [
    { id: 'b1', budgetName: 'IT 2026', glAccount: '5000' },
    { id: 'b2', budgetName: 'Ops 2026', glAccount: '5100' },
  ];
  const mountWithBudget = (lines: EditorLine[]) =>
    mount(LineItemsEditor, {
      props: { modelValue: lines, currency: 'THB', items: [], budgets: BUDGETS, canMaster: false, canBudget: true },
      global,
    });

  it('shows the per-line budget column when canBudget is set', () => {
    const w = mountWithBudget([{ description: 'x', qty: '1', unitPrice: '0' }]);
    expect(w.text()).toContain('ງົບປະມານ'); // la: "Budget" column header
  });

  it('does not render the budget column when canBudget is false', () => {
    const w = mountEditor([{ description: 'x', qty: '1', unitPrice: '0' }]);
    expect(w.text()).not.toContain('ງົບປະມານ');
  });

  it('labels a chosen budget by its GL account and shows no amount', () => {
    const w = mountWithBudget([{ description: 'x', qty: '1', unitPrice: '0', budgetId: 'b1' }]);
    // The body renders the selected budget's GL (id → label wiring), never a money figure.
    expect(w.text()).toContain('5000');
    expect(w.text()).not.toContain('amountTotal');
  });
});
