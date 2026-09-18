import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import LineItemsEditor, { type EditorLine } from './LineItemsEditor.vue';

/**
 * A line reopened naming a budget that has since been closed, or an item withdrawn from the
 * catalogue.
 *
 * A `Select` renders its PLACEHOLDER for a model value that is not among its options, and a
 * placeholder is what a control nobody ever filled looks like. That is not a cosmetic difference:
 * the user answers an empty required picker by re-picking it and saving, and everything else the
 * load could not restore is saved over at the same time — which is how the day a spend happened
 * came to be dropped. The control has to say the value is GONE, not imply it was never there.
 *
 * The id itself is kept, not discarded. What was saved is what the server is left to refuse.
 */
const global = { plugins: [createTestingPinia({ createSpy: vi.fn }), i18n, PrimeVue] };

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });

const BUDGETS = [{ id: 'b-106', code: '1.106', budgetName: 'Support' }];
const ITEMS = [{ id: 'i-1', name: 'Paper', defaultGlAccount: '5100', isStockTracked: false }] as never[];

const mountEditor = (lines: EditorLine[], budgets = BUDGETS, items = ITEMS, optionsReady = true) =>
  mount(LineItemsEditor, {
    props: {
      modelValue: lines,
      currency: 'THB',
      items,
      budgets,
      canMaster: true,
      canBudget: true,
      requiresBudget: true,
      optionsReady,
    },
    global,
  });

/** The `Select` bound to the budget — the only grouped one on the card. */
const budgetSelect = (w: ReturnType<typeof mountEditor>) =>
  w.findAllComponents({ name: 'Select' }).find((s) => s.props('optionGroupChildren') === 'items')!;
/** The item picker: the ungrouped `Select` whose options are the item list. */
const itemSelect = (w: ReturnType<typeof mountEditor>) =>
  w.findAllComponents({ name: 'Select' }).find((s) => s.props('optionLabel') === 'name')!;

const line = (over: Partial<EditorLine> = {}): EditorLine => ({
  description: 'Q1 spend', qty: '1', unitPrice: '3000000', ...over,
});

describe('a line naming a budget the picker can no longer offer', () => {
  it('marks the picker invalid rather than leaving it quietly empty', () => {
    const w = mountEditor([line({ budgetId: 'b-closed' })]);
    expect(budgetSelect(w).props('invalid')).toBe(true);
  });

  it('says the saved budget is gone, not that one was never chosen', () => {
    const w = mountEditor([line({ budgetId: 'b-closed' })]);
    expect(w.text()).toContain('no longer available');
    expect(w.text()).not.toContain('Select a budget for this line.');
  });

  it('leaves a budget that is still offered alone', () => {
    const w = mountEditor([line({ budgetId: 'b-106' })]);
    expect(budgetSelect(w).props('invalid')).toBe(false);
    expect(w.text()).not.toContain('no longer available');
  });

  it('still says REQUIRED for a line that names no budget at all', () => {
    const w = mountEditor([line()]);
    expect(budgetSelect(w).props('invalid')).toBe(true);
    expect(w.text()).toContain('Select a budget for this line.');
  });

  it('does not accuse the picker while its options are still loading', () => {
    // The budget list arrives asynchronously; before it lands nothing is gone, it has just not
    // arrived. Saying otherwise would be a lie on every single reload.
    const w = mountEditor([line({ budgetId: 'b-106' })], [], ITEMS, false);
    expect(w.text()).not.toContain('no longer available');
  });

  it('reports it once the list has loaded and come back empty', () => {
    // The case an "is the list non-empty?" guard silently swallowed, and the one that turned up
    // the moment this was opened against real data: a user whose department offers no budget at
    // all gets a fully-loaded EMPTY list, and the budget on the line is exactly as unofferable as
    // a closed one. Suppressing it there is suppressing it where it matters most.
    const w = mountEditor([line({ budgetId: 'b-106' })], []);
    expect(budgetSelect(w).props('invalid')).toBe(true);
    expect(w.text()).toContain('no longer available');
  });
});

describe('a line naming an item the picker can no longer offer', () => {
  it('marks it and says so', () => {
    const w = mountEditor([line({ budgetId: 'b-106', itemId: 'i-withdrawn' })]);
    expect(itemSelect(w).props('invalid')).toBe(true);
    expect(w.text()).toContain('no longer available');
  });

  it('leaves an item that is still offered alone', () => {
    const w = mountEditor([line({ budgetId: 'b-106', itemId: 'i-1' })]);
    expect(itemSelect(w).props('invalid')).toBe(false);
  });
});

/**
 * Money the whole company draws on, offered alongside the requester's own.
 *
 * The picker used to be given only the signed-in user's department's budgets, which enforced a rule
 * nothing else in the system holds and left anyone in a department holding no budget with nothing
 * to choose. What a caller may charge is the server's answer now; the picker's job is to make the
 * difference visible, because shared money and a department's own look identical from a code and a
 * name.
 */
describe('the picker separates shared money from the department’s own', () => {
  const OWN = { id: 'b-201', code: '1.201', budgetName: 'Postal licence', isShared: false };
  const SHARED = { id: 'b-406', code: '1.406', budgetName: 'Phone bills', isShared: true };

  /** The groups the budget Select was given, in the order it was given them. */
  const groups = (w: ReturnType<typeof mountEditor>) =>
    (budgetSelect(w).props('options') as Array<{ label: string; items: unknown[] }>).map((g) => g.label);

  it('puts shared budgets in their own group', () => {
    const w = mountEditor([line({ budgetId: 'b-201' })], [OWN, SHARED] as never);
    expect(groups(w)).toContain('Shared — the whole company draws on these');
  });

  it('puts that group first, where it is read before the rest', () => {
    const w = mountEditor([line({ budgetId: 'b-201' })], [OWN, SHARED] as never);
    expect(groups(w)[0]).toBe('Shared — the whole company draws on these');
  });

  it('leaves a list with nothing shared exactly as it was', () => {
    const w = mountEditor([line({ budgetId: 'b-201' })], [OWN] as never);
    expect(groups(w)).not.toContain('Shared — the whole company draws on these');
  });

  it('offers a shared budget to a requester whose department holds none of its own', () => {
    // The whole point: a department with no budget is not a department that cannot spend.
    const w = mountEditor([line()], [SHARED] as never);
    const opts = budgetSelect(w).props('options') as Array<{ items: unknown[] }>;
    expect(opts.flatMap((g) => g.items)).toHaveLength(1);
  });
});

/**
 * A budget that came with the document is offered back, whoever is editing.
 *
 * A PO raised from ADM's PR carries ADM's budget on its line; Procurement's own picker never held
 * that budget, so the line read as "no longer available" and the step was blocked — and the way
 * past it was to reclassify ADM's money as shared. The read now returns the document's own budgets
 * flagged `inherited`; the picker shows them first, under a heading that says where they came from,
 * and stops accusing the line.
 */
describe('the picker offers back a budget that came with the document', () => {
  const OWN = { id: 'b-201', code: '2.101', budgetName: 'Tender costs', isShared: false };
  const INHERITED = { id: 'b-adm', code: '1.101', budgetName: 'Drinking water', isShared: false, inherited: true };
  const SHARED = { id: 'b-406', code: '1.406', budgetName: 'Phone bills', isShared: true };

  const groups = (w: ReturnType<typeof mountEditor>) =>
    (budgetSelect(w).props('options') as Array<{ label: string; items: Array<{ id: string }> }>);

  it('does not call an inherited budget unavailable', () => {
    const w = mountEditor([line({ budgetId: 'b-adm' })], [OWN, INHERITED] as never);
    expect(budgetSelect(w).props('invalid')).toBe(false);
    expect(w.text()).not.toContain('no longer available');
  });

  it('puts inherited budgets in their own group, ahead of shared and own', () => {
    const w = mountEditor([line({ budgetId: 'b-adm' })], [OWN, SHARED, INHERITED] as never);
    const labels = groups(w).map((g) => g.label);
    expect(labels[0]).toBe('Came with this document — chosen on the document it was created from');
    expect(labels[1]).toBe('Shared — the whole company draws on these');
    expect(groups(w)[0].items.map((i) => i.id)).toEqual(['b-adm']);
  });

  it('leaves a list with nothing inherited exactly as it was', () => {
    const w = mountEditor([line({ budgetId: 'b-201' })], [OWN, SHARED] as never);
    expect(groups(w).map((g) => g.label)).not.toContain('Came with this document — chosen on the document it was created from');
  });
});
