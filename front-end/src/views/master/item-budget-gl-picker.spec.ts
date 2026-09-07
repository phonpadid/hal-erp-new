import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mountView } from '../../test/mountView';
import { budgetsApi } from '../../api/budgets';
import MasterDataView from './MasterDataView.vue';

/**
 * The item master names an item's account BY BUDGET, and stores the account.
 *
 * The column used to offer the chart of accounts, which is what the row holds — but an admin knows
 * 5000 as "the office-supplies budget", not as 5000. Asking in budgets and storing the account is
 * the only shape that survives a year-end: a budget is keyed by fiscal year and department, and an
 * item is scoped to neither, so an item that named a budget would go stale every January and be
 * wrong for every department but the one it was set from.
 */

/** Six budgets on three accounts — the customer's real shape, several budgets per account. */
const GL_OPTIONS = [
  { glAccount: '5000', code: '1.101', budgetName: 'Office supplies', departmentName: 'Admin' },
  { glAccount: '5000', code: '1.101', budgetName: 'Office supplies', departmentName: 'HR' },
  { glAccount: '5000', code: '1.102', budgetName: 'General expenses', departmentName: 'Admin' },
  { glAccount: '5000', code: '1.103', budgetName: 'Stationery', departmentName: 'Ops' },
  { glAccount: '5001', code: '1.205', budgetName: 'IT expenses', departmentName: 'IT' },
  { glAccount: '5002', code: '1.301', budgetName: undefined, departmentName: 'Ops' },
];

const ITEMS = [
  { id: 'i1', itemCode: 'I001', name: 'A4 Paper', defaultUnit: 'ea', enabled: true, defaultGlAccount: '5000' },
  { id: 'i2', itemCode: 'I003', name: 'router Wifi', defaultUnit: 'ea', enabled: true, defaultGlAccount: '5001' },
  // Set to an account no open-year budget names — a closed year's budget, or a hand-set code.
  { id: 'i3', itemCode: 'I009', name: 'Legacy', defaultUnit: 'ea', enabled: true, defaultGlAccount: '5999' },
];

const mountItems = async (permissions?: string[]) => {
  const w = await mountView(MasterDataView, {
    path: '/master-data',
    routeName: 'master-data',
    permissions,
    initialState: { masterData: { items: ITEMS, itemTotal: ITEMS.length, itemPage: 1, itemLimit: 20 } },
  });
  await flushPromises();
  return w;
};

/** The account picker on a given item row, by the item's stored account code. */
const pickerFor = (w: VueWrapper, gl: string) =>
  w.findAllComponents({ name: 'Select' }).find((s) => s.props('modelValue') === gl);

const optionsOf = (w: VueWrapper, gl: string) =>
  pickerFor(w, gl)!.props('options') as Array<{ code: string; label: string }>;

// Mounted once for the whole suite: the view is a full master-data screen, and remounting it per
// assertion costs seconds without exercising anything the first mount did not.
let view: VueWrapper;
beforeAll(async () => {
  vi.spyOn(budgetsApi, 'glOptions').mockResolvedValue(GL_OPTIONS);
  view = await mountItems();
});

describe('the item master picks an account by budget', () => {
  it('reads budgets, not the chart of accounts', () => {
    expect(budgetsApi.glOptions).toHaveBeenCalled();
  });

  it('offers one option per ACCOUNT, labelled by the budgets that post to it', () => {
    const options = optionsOf(view, '5000');

    // Four budgets on 5000 collapse to ONE option: the account is what gets stored, so listing them
    // separately would be four choices with one outcome. Ordered by the label a reader sees.
    expect(options.map((o) => o.code)).toEqual(['5002', '5000', '5001']);
    // Three distinct names on one account → two, then a count. Asserted as a prefix because the
    // suffix ("+1 more") is localized and this suite runs in the default locale.
    expect(options.find((o) => o.code === '5000')!.label).toMatch(/^General expenses, Office supplies \+1\b/);
    expect(options.find((o) => o.code === '5001')!.label).toBe('IT expenses');
    // A budget with no name of its own falls back to its plan code, never to a blank row.
    expect(options.find((o) => o.code === '5002')!.label).toBe('1.301');
  });

  it('keeps an account no budget names selectable rather than showing the row as unset', () => {
    // Without this the Select matches nothing and renders empty — a set row reading as unset.
    const options = optionsOf(view, '5999');
    expect(options[0].code).toBe('5999');
    expect(options[0].label).toContain('5999');
    // And it is offered ONLY to the row that holds it, not added to every picker.
    expect(optionsOf(view, '5001').map((o) => o.code)).not.toContain('5999');
  });

  it('shows the budget name, not a bare code, to a reader who cannot manage', async () => {
    const w = await mountItems(['MASTER_VIEW']);
    expect(pickerFor(w, '5001')).toBeUndefined(); // no picker without MASTER_MANAGE
    expect(w.text()).toContain('IT expenses');
    expect(w.text()).toContain('5001'); // the stored code stays visible beside it
  });
});
