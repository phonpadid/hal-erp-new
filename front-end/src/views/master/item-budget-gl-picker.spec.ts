import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mountView } from '../../test/mountView';
import { budgetsApi } from '../../api/budgets';
import { useMasterDataStore } from '../../stores/masterData';
import MasterDataView from './MasterDataView.vue';

/**
 * The item master binds an item to ONE budget, by that budget's plan code.
 *
 * The column used to store the GL account, and the screen folded every budget on an account into a
 * single option — four budgets, one line, and no way to record the one an admin meant. 612.06 at
 * this customer is the account of ຄ່າເຊົ່າ ເຊີເວີ HAL Express, AMAZON Web Services, PubNub and Mail
 * Express alike, so the account never was the choice. The plan code is: `budget_node` is unique on
 * `(fiscal_year_id, code)`, so one code names one budget, and it goes on meaning the same budget
 * after a new fiscal year opens — which a `budget.id` would not.
 */

/** The customer's shape: four budgets on one account, plus two on accounts of their own. */
const GL_OPTIONS = [
  { glAccount: '612.06', code: '6.101', budgetName: 'ຄ່າເຊົ່າ ເຊີເວີ HAL Express', departmentName: 'IT' },
  { glAccount: '612.06', code: '6.102', budgetName: 'AMAZON Web Services', departmentName: 'IT' },
  { glAccount: '612.06', code: '6.103', budgetName: 'PubNub', departmentName: 'IT' },
  { glAccount: '612.06', code: '6.107', budgetName: 'Mail Express', departmentName: 'IT' },
  { glAccount: '623.08', code: '6.112', budgetName: 'SMS', departmentName: 'IT' },
  // A budget with no name of its own — the picker falls back to its plan code, never a blank row.
  { glAccount: '656.04', code: '1.106', budgetName: undefined, departmentName: 'Admin' },
];

const ITEMS = [
  { id: 'i1', itemCode: 'I001', name: 'Server', defaultUnit: 'mo', enabled: true, defaultGlAccount: '612.06', defaultBudgetCode: '6.101', defaultBudgetName: 'ຄ່າເຊົ່າ ເຊີເວີ HAL Express' },
  { id: 'i2', itemCode: 'I003', name: 'SMS', defaultUnit: 'mo', enabled: true, defaultGlAccount: '623.08', defaultBudgetCode: '6.112', defaultBudgetName: 'SMS' },
  // Bound to a plan code the open fiscal year no longer carries — a line retired at year-end.
  { id: 'i3', itemCode: 'I009', name: 'Legacy', defaultUnit: 'ea', enabled: true, defaultGlAccount: '612.06', defaultBudgetCode: '9.999' },
  // Enabled before an item could name a budget: an account and nothing else.
  { id: 'i4', itemCode: 'I010', name: 'Unbound', defaultUnit: 'ea', enabled: true, defaultGlAccount: '612.06' },
];

type Choice = { code: string; name: string; departmentName: string; glAccount: string };

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

/** The budget picker on a given item row, by the plan code the item is bound to. */
const pickerFor = (w: VueWrapper, code: string) =>
  w.findAllComponents({ name: 'Select' }).find((s) => s.props('modelValue') === code);

const choicesOf = (w: VueWrapper, code: string) => pickerFor(w, code)!.props('options') as Choice[];

// Mounted once for the whole suite: the view is a full master-data screen, and remounting it per
// assertion costs seconds without exercising anything the first mount did not.
let view: VueWrapper;
beforeAll(async () => {
  vi.spyOn(budgetsApi, 'glOptions').mockResolvedValue(GL_OPTIONS);
  view = await mountItems();
});

describe('the item master binds an item to one budget', () => {
  it('reads budgets, not the chart of accounts', () => {
    expect(budgetsApi.glOptions).toHaveBeenCalled();
  });

  it('offers one row per BUDGET, never folding those that share an account', () => {
    const choices = choicesOf(view, '6.101');

    // Four budgets on 612.06 are four options. Folded by account they were one option with four
    // meanings — the defect this replaces.
    expect(choices.filter((c) => c.glAccount === '612.06').map((c) => c.code)).toEqual([
      '6.101',
      '6.102',
      '6.103',
      '6.107',
    ]);
    // Ordered by plan code, the order the plan itself is written in.
    expect(choices.map((c) => c.code)).toEqual(['1.106', '6.101', '6.102', '6.103', '6.107', '6.112']);
    // Each row carries what tells it from its neighbours, and what the books are read by.
    expect(choices.find((c) => c.code === '6.107')).toMatchObject({
      name: 'Mail Express',
      departmentName: 'IT',
      glAccount: '612.06',
    });
    // A budget with no name of its own falls back to its plan code.
    expect(choices.find((c) => c.code === '1.106')!.name).toBe('1.106');
  });

  it('saves the plan code of the budget clicked, not an account', async () => {
    const md = useMasterDataStore();
    pickerFor(view, '6.101')!.vm.$emit('update:modelValue', '6.107');
    await flushPromises();

    // The one budget picked, by its own code. The account is stamped server-side from that budget,
    // so nothing here sends 612.06 — which would have named all four budgets at once.
    expect(md.setItemEnabled).toHaveBeenCalledWith('i1', true, '6.107');
  });

  it('keeps a binding the open year no longer carries visible rather than showing it as unset', () => {
    // Without this the Select matches nothing and renders empty — a bound row reading as unbound.
    const choices = choicesOf(view, '9.999');
    expect(choices[0].code).toBe('9.999');
    expect(choices[0].name).toContain('9.999');
    // And it is offered ONLY to the row that holds it, not added to every picker.
    expect(choicesOf(view, '6.112').map((c) => c.code)).not.toContain('9.999');
  });

  it('shows an item that predates budget binding by the account it still posts to', () => {
    // It is not bound, so no picker on this row matches a code — but the row must not read as
    // empty either: it carries an account and goes on posting to it.
    expect(view.text()).toContain('612.06');
  });

  it('shows the budget name, not a bare code, to a reader who cannot manage', async () => {
    const w = await mountItems(['MASTER_VIEW']);
    expect(pickerFor(w, '6.101')).toBeUndefined(); // no picker without MASTER_MANAGE
    expect(w.text()).toContain('ຄ່າເຊົ່າ ເຊີເວີ HAL Express');
    expect(w.text()).toContain('6.101'); // the stored plan code stays visible beside it
  });
});
