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

const base = {
  requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
  requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false,
};

const TYPES: CreatableType[] = [
  { id: 't1', code: 'PR', name: 'Purchase Request', category: 'PROCUREMENT', requiresBudget: true, requiresQuota: false, requiresVendor: true, requiresItem: true, requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false },
  { id: 't2', code: 'LV', name: 'Leave Request', category: 'HR', requiresBudget: false, requiresQuota: true, requiresVendor: false, requiresItem: false, requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false },
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
    { id: 'b1', code: '1.101', budgetName: 'IT 2026' },
    { id: 'b2', code: '1.102', budgetName: 'Ops 2026' },
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

  it('labels a chosen budget by its plan code and name, and shows no amount', () => {
    const w = mountWithBudget([{ description: 'x', qty: '1', unitPrice: '0', budgetId: 'b1' }]);
    // "code — name": the code is the budget's identity and what a department head says out loud.
    // It used to read "name (GL)", which cannot identify anything now that several budgets share
    // one account. No money figure either — this read carries no amounts at all.
    expect(w.text()).toContain('1.101');
    expect(w.text()).toContain('IT 2026');
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

  // --- Prefilling a line's budget from the item's account ----------------------------------
  //
  // The maintainer already named the item's account on the item-master screen. Where that account
  // admits exactly one budget the requester's department can charge, asking again has one possible
  // answer — so the editor offers it. Where it admits several, or none, the requester still names
  // it: guessing between budgets is what the removed server-side derivation did wrong.
  const PREFILL_ITEMS = [
    { id: 'srv', name: 'Server hosting', defaultGlAccount: '5001', isActive: true },
    { id: 'paper', name: 'A4 Paper', defaultGlAccount: '5000', isActive: true },
    { id: 'misc', name: 'Sundries', defaultGlAccount: '9999', isActive: true },
    { id: 'noGl', name: 'Free text', isActive: true },
  ] as never;
  // 5001 → one budget. 5000 → two, the shape that makes an account unable to choose (fuel, repairs
  // and registration on one account is the customer's own case).
  const PREFILL_BUDGETS = [
    { id: 'b-it', code: '5001', budgetName: 'IT development', glAccount: '5001' },
    { id: 'b-office', code: '5000', budgetName: 'Office', glAccount: '5000' },
    { id: 'b-admin', code: '5000.1', budgetName: 'Office — admin', glAccount: '5000' },
    { id: 'b-split', code: '6100', budgetName: 'Vehicle instalment' },
  ];
  /** Mount, then pick `itemId` on line 0 the way the item Select does (v-model + @change). */
  const pickItem = async (lines: EditorLine[], itemId?: string) => {
    const w = mount(LineItemsEditor, {
      props: { modelValue: lines, currency: 'THB', items: PREFILL_ITEMS, budgets: PREFILL_BUDGETS, canMaster: true, canBudget: true, requiresBudget: true },
      global,
    });
    lines[0].itemId = itemId;
    await w.findAllComponents({ name: 'Select' })[0].vm.$emit('change');
    return w;
  };

  it('prefills the budget when the item’s account names exactly one', async () => {
    const lines: EditorLine[] = [{ description: 'x', qty: '1', unitPrice: '100' }];
    await pickItem(lines, 'srv');
    expect(lines[0].budgetId).toBe('b-it');
  });

  it('prefills nothing when the item’s account is carried by several budgets', async () => {
    // The account cannot choose between them; only the requester can. Left unanswered, and the
    // line stays flagged so the wizard's own coverage rule still asks.
    const lines: EditorLine[] = [{ description: 'x', qty: '1', unitPrice: '100' }];
    const w = await pickItem(lines, 'paper');
    expect(lines[0].budgetId).toBeUndefined();
    expect(w.text()).toContain('ເລືອກງົບປະມານສຳລັບແຖວນີ້'); // la: "Choose a budget for this line."
  });

  it('prefills nothing when no budget carries the item’s account', async () => {
    const lines: EditorLine[] = [{ description: 'x', qty: '1', unitPrice: '100' }];
    await pickItem(lines, 'misc');
    expect(lines[0].budgetId).toBeUndefined();
  });

  it('does not pair an item with no GL against a budget that names no account', async () => {
    // Both sides absent must not match: undefined === undefined would hand `b-split` — a budget
    // whose spending splits across several accounts — to every free-text line.
    const lines: EditorLine[] = [{ description: 'x', qty: '1', unitPrice: '100' }];
    await pickItem(lines, 'noGl');
    expect(lines[0].budgetId).toBeUndefined();
  });

  it('keeps a budget the requester named when the item is chosen or changed', async () => {
    // The regression this change exists for: `onItemChange` used to clear `budgetId` outright, so
    // choosing an item silently discarded a deliberate choice and blocked the step.
    const lines: EditorLine[] = [{ description: 'x', qty: '1', unitPrice: '100', budgetId: 'b-admin' }];
    const w = await pickItem(lines, 'srv');
    expect(lines[0].budgetId).toBe('b-admin');

    // ...and changing the item again leaves it alone, rather than re-prefilling over it.
    lines[0].itemId = 'paper';
    await w.findAllComponents({ name: 'Select' })[0].vm.$emit('change');
    expect(lines[0].budgetId).toBe('b-admin');
  });

  it('lets the requester override a prefilled budget, and prefilling leaves the GL alone', async () => {
    const lines: EditorLine[] = [{ description: 'x', qty: '1', unitPrice: '100' }];
    const w = await pickItem(lines, 'srv');
    expect(lines[0].budgetId).toBe('b-it');
    // The GL chip still reads the ITEM's account — a prefill names a budget, never an account.
    expect(w.text()).toContain('5001');

    // The picker is a live control over the same field, not a read-only echo of the prefill.
    const budgetSelect = w.findAllComponents({ name: 'Select' }).find((s) => s.props('optionGroupLabel') === 'label');
    expect(budgetSelect).toBeDefined();
    await budgetSelect!.vm.$emit('update:modelValue', 'b-office');
    expect(lines[0].budgetId).toBe('b-office');
  });
});

// The wizard used to offer every type the same four steps, including the ones whose content it
// cannot author. These cover the client half of the remedy.
describe('a type the wizard cannot author', () => {
  it('keeps its card in the grid rather than hiding the capability', () => {
    const types: CreatableType[] = [
      { ...base, id: 'a', code: 'MEMO', name: 'Memo', category: 'ADMIN' },
      { ...base, id: 'b', code: 'LEAVE', name: 'Leave', category: 'HR', authoringRoute: 'request-leave' },
    ];
    const w = mount(DocumentTypePicker, { props: { modelValue: '', types }, global });
    // A requester looking for leave looks where documents are made; omitting it would teach nothing.
    expect(w.findAll('[role="radio"]')).toHaveLength(2);
  });

});
