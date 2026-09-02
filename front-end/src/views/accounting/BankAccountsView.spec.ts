import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
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
});
