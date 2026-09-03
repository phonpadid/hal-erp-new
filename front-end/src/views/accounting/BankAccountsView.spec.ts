import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BANKS } from '../../shared/banks';
import { useBankAccountsStore } from '../../stores/bankAccounts';
import { mountView } from '../../test/mountView';
import BankAccountsView from './BankAccountsView.vue';
import type { BankAccountRow } from '../../api/bankAccounts';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const ACCOUNTS: BankAccountRow[] = [
  {
    id: 'b-1', name: 'Main', bankName: 'BCEL', accountNo: '010-1',
    currency: { code: 'THB' },
    glAccount: { id: 'a-1', code: '1000', name: 'Cash' },
    isActive: true,
  },
];

async function mount(permissions: string[]) {
  const w = await mountView(BankAccountsView, {
    path: '/bank-accounts',
    routeName: 'bank-accounts',
    permissions,
    initialState: { bankAccounts: { accounts: ACCOUNTS, unattributed: { items: [], total: '0' } } },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('BankAccountsView', () => {
  it('lists the accounts with the ledger account each one maps to', async () => {
    const text = (await mount(['BANK_ACCOUNT_VIEW'])).text();
    expect(text).toContain('010-1');
    // The mapping is the whole point: getting it wrong misstates cash.
    expect(text).toContain('1000');
    expect(text).toContain('Cash');
  });

  it('offers no create or deactivate control without BANK_ACCOUNT_MANAGE', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW']);
    expect(w.find('[data-testid="create-bank-account"]').exists()).toBe(false);
    expect(w.find('[data-testid="deactivate-bank-account"]').exists()).toBe(false);
  });

  it('offers them to a holder of the management code', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW', 'BANK_ACCOUNT_MANAGE']);
    expect(w.find('[data-testid="create-bank-account"]').exists()).toBe(true);
    // Deactivate, never delete: payments point at these rows.
    expect(w.find('[data-testid="deactivate-bank-account"]').exists()).toBe(true);
  });

  it('keeps the save control disabled until every field is given', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW', 'BANK_ACCOUNT_MANAGE']);
    await w.find('[data-testid="create-bank-account"]').trigger('click');
    await flushPromises();

    const save = document.body.querySelector('[data-testid="save-bank-account"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('shows the bank logo in the list, not just in the picker', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW']);

    const logo = w.find('td img');
    expect(logo.exists()).toBe(true);
    expect(logo.attributes('src')).toContain('banks/bcel.png');
    expect(logo.attributes('alt')).toBe('BCEL');
  });

  it('picks the bank rather than accepting typed text', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW', 'BANK_ACCOUNT_MANAGE']);
    await w.find('[data-testid="create-bank-account"]').trigger('click');
    await flushPromises();

    // One bank must read as one bank: this value is the bank on this screen and on reconciliation.
    expect(document.body.querySelector('[data-testid="ba-bank"]')).toBeTruthy();
    expect(document.body.querySelector('input[data-testid="ba-bank"]')).toBeNull();
  });

  it('offers the catalog banks by name, and nothing else, when creating', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW', 'BANK_ACCOUNT_MANAGE']);
    await w.find('[data-testid="create-bank-account"]').trigger('click');
    await flushPromises();

    const choices = (w.vm.$ as unknown as { setupState: Record<string, any> }).setupState.bankChoices;
    // The name, not the code — `bank_account.bank_name` is shown as the bank's name.
    expect(choices.map((o: { value: string }) => o.value)).toEqual(BANKS.map((b) => b.name));
  });

  it('sends the picked bank as its name, one string, unchanged in shape', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW', 'BANK_ACCOUNT_MANAGE']);
    await w.find('[data-testid="create-bank-account"]').trigger('click');
    await flushPromises();

    const state = (w.vm.$ as unknown as { setupState: Record<string, any> }).setupState;
    const store = useBankAccountsStore();
    const create = vi.spyOn(store, 'create').mockResolvedValue(true);
    state.form.name = 'Main';
    state.form.bankName = 'ACLEDA Bank';
    state.form.accountNo = '010-1';
    state.form.currencyCode = 'LAK';
    state.form.glAccountId = 'a-1';
    await flushPromises();

    await state.submit();

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ bankName: 'ACLEDA Bank' }));
  });
});
