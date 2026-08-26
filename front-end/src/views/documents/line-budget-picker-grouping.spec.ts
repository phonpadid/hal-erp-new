import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import LineItemsEditor, { type EditorLine } from './LineItemsEditor.vue';

const global = { plugins: [createTestingPinia({ createSpy: vi.fn }), i18n, PrimeVue] };

/** The heading budgets with no parent fall under, in the locale the suite runs in. */
const UNGROUPED = 'ງົບປະມານອື່ນໆ';

/**
 * The budget control groups by the category each budget's node hangs under.
 *
 * A department's budgets are a tree and the leaves are named as if the branch were visible. The
 * customer's largest department offers 92 of them, six reading `ງົບເດີນທາງ ພນ ບໍລິຫານ`,
 * `… ພນ ບຸກຄະລາກອນ`, `… ພນ ມາດຕະຖານ` — one word apart, meaningless flat. Under their category
 * they are six departments' travel budgets and the choice is obvious.
 *
 * The category is the ONLY thing that distinguishes them here, and deliberately not the balance:
 * this picker is fed by a `DOC_CREATE` read that carries no figures, so a requester who may not
 * read budget balances can still raise a document.
 */

/** The real shape: siblings under a category, plus one budget whose node has no parent. */
const BUDGETS = [
  { id: 'b1', code: '1.111', budgetName: 'Travel — admin', parentId: 'p-travel', parentCode: '1.11', parentName: 'Travel to the provinces' },
  { id: 'b2', code: '1.112', budgetName: 'Travel — HR', parentId: 'p-travel', parentCode: '1.11', parentName: 'Travel to the provinces' },
  { id: 'b3', code: '1.101', budgetName: 'Office supplies', parentId: 'p-admin', parentCode: '1.1', parentName: 'General administration' },
  { id: 'b4', code: '9.900', budgetName: 'Standalone fund' },
];

const mountEditor = (lines: EditorLine[], budgets = BUDGETS) =>
  mount(LineItemsEditor, {
    props: { modelValue: lines, currency: 'THB', items: [], budgets, canMaster: false, canBudget: true, requiresBudget: true },
    global,
  });

const line = (): EditorLine => ({ description: 'x', qty: '1', unitPrice: '100' });

/** The `Select` bound to the budget — the only grouped one on the card. */
const budgetSelect = (w: ReturnType<typeof mountEditor>) =>
  w.findAllComponents({ name: 'Select' }).find((s) => Array.isArray(s.props('options')) && s.props('optionGroupChildren') === 'items')!;

describe('the line budget picker groups by category', () => {
  it('puts each budget under its category, ordered by parent code then name', () => {
    const groups = budgetSelect(mountEditor([line()])).props('options') as Array<{ label: string; items: Array<{ label: string }> }>;

    expect(groups.map((g) => g.label)).toEqual([
      '1.1 — General administration',
      '1.11 — Travel to the provinces',
      UNGROUPED, // la: "Other budgets" — the suite runs in the default locale
    ]);
    expect(groups[1].items.map((i) => i.label)).toEqual([
      '1.111 — Travel — admin',
      '1.112 — Travel — HR',
    ]);
  });

  it('offers a budget whose node has no parent rather than dropping it', () => {
    // Omitting it would make a line unbudgetable through the UI while the server still accepts it.
    const groups = budgetSelect(mountEditor([line()])).props('options') as Array<{ label: string; items: Array<{ id: string }> }>;
    const other = groups.find((g) => g.label === UNGROUPED)!;
    expect(other.items.map((i) => i.id)).toEqual(['b4']);
  });

  it('lets the filter match a category name, not only a budget code or name', () => {
    // Grouping alone trades one scanning problem for another: thirteen collapsed headings still
    // need a way in. Each option carries its heading so typing the category narrows to its members.
    const select = budgetSelect(mountEditor([line()]));
    expect(select.props('filterFields')).toEqual(['label', 'group']);

    const groups = select.props('options') as Array<{ items: Array<{ group: string }> }>;
    expect(groups.flatMap((g) => g.items.map((i) => i.group))).toContain('1.11 — Travel to the provinces');
  });

  it('says what its filter accepts', () => {
    // It filtered before this change too, and looked like an empty box beside a magnifier.
    const select = budgetSelect(mountEditor([line()]));
    expect(select.props('filter')).toBe(true);
    expect(String(select.props('filterPlaceholder'))).not.toBe('');
  });

  it('shows no amount, balance or ledger figure for any budget', () => {
    // The guard on the permission boundary: the read behind this control carries no figures, and
    // the control must not invent one. A category name is a label, not money.
    const groups = budgetSelect(mountEditor([line()])).props('options') as Array<{ label: string; items: Array<{ label: string }> }>;
    for (const g of groups) {
      for (const item of g.items) {
        expect(Object.keys(item).sort()).toEqual(['group', 'id', 'label']);
      }
    }
    // Nothing money-shaped reached the rendered control either.
    expect(budgetSelect(mountEditor([line()])).text()).not.toMatch(/\d{1,3}(,\d{3})+/);
  });

  it('still resolves a chosen budget to its own label', () => {
    const w = mountEditor([{ ...line(), budgetId: 'b2' }]);
    expect(w.text()).toContain('1.112 — Travel — HR');
  });
});
