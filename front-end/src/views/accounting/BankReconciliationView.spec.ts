import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../../test/mountView';
import BankReconciliationView from './BankReconciliationView.vue';
import { useBankAccountsStore } from '../../stores/bankAccounts';
import type { BankAccountRow, BankReconciliation } from '../../api/bankAccounts';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const ACCOUNT: BankAccountRow = {
  id: 'b-1', name: 'Main', bankName: 'BCEL', accountNo: '010-1',
  currency: { code: 'THB' },
  glAccount: { id: 'a-1', code: '1000', name: 'Cash' },
  isActive: true,
};

const RECON: BankReconciliation = {
  bankAccount: ACCOUNT,
  glBalance: '900000.00',
  items: [
    { paymentId: 'p-1', documentNo: 'PV-0001', amount: '100000.00', paidAt: '2026-05-10' },
    { paymentId: 'p-2', documentNo: 'PV-0002', amount: '48500.00', paidAt: '2026-05-11' },
  ],
  total: '148500.00',
};

async function mount(permissions: string[], over: Record<string, unknown> = {}) {
  const w = await mountView(BankReconciliationView, {
    path: '/bank-reconciliation',
    routeName: 'bank-reconciliation',
    permissions,
    initialState: {
      bankAccounts: {
        accounts: [ACCOUNT],
        reconciliation: RECON,
        unattributed: { items: [], total: '0' },
        ...over,
      },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const inBody = (testid: string) => document.body.querySelector(`[data-testid="${testid}"]`);

describe('BankReconciliationView', () => {
  it('shows the ledger balance and what is in flight', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW']);
    expect(w.find('[data-testid="gl-balance"]').text()).toBe('900,000.00');
    expect(w.find('[data-testid="outstanding-total"]').text()).toBe('148,500.00');
  });

  it('lists the payments the bank has not confirmed', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW']);
    const amounts = w.findAll('[data-testid="outstanding-amount"]').map((n) => n.text());
    expect(amounts).toEqual(['100,000.00', '48,500.00']);
  });

  it('offers no confirm control without PAYMENT_MANAGE', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW']);
    expect(w.find('[data-testid="confirm-cleared"]').exists()).toBe(false);
  });

  it('confirms a payment on the date the bank gives, not today', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW', 'PAYMENT_MANAGE']);
    const store = useBankAccountsStore();
    vi.mocked(store.confirmCleared).mockResolvedValue(true);

    await w.findAll('[data-testid="confirm-cleared"]')[0].trigger('click');
    await flushPromises();
    // The date is empty until the operator gives the bank's: confirming without one is refused.
    expect((inBody('confirm-cleared-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('surfaces payments that name no bank account', async () => {
    // They sit in the clearing balance and belong to no reconciliation. Hiding them would leave a
    // clearing account that can never settle with nothing on screen explaining why.
    const w = await mount(['BANK_ACCOUNT_VIEW'], {
      unattributed: {
        items: [{ paymentId: 'p-9', documentNo: 'PV-0009', amount: '3300.00' }],
        total: '3300.00',
      },
    });
    const panel = w.find('[data-testid="unattributed"]');
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain('3,300.00');
  });

  it('hides the unattributed panel when there is nothing unattributed', async () => {
    const w = await mount(['BANK_ACCOUNT_VIEW']);
    expect(w.find('[data-testid="unattributed"]').exists()).toBe(false);
  });
});
