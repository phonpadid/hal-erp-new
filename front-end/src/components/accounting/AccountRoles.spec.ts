import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import AccountRoles from './AccountRoles.vue';
import { accountRolesApi } from '../../api/accountRoles';
import { accountsApi } from '../../api/accounts';

const can = vi.fn((_code: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c) }) }));
vi.mock('../../composables/useFeedback', () => ({
  useFeedback: () => ({ error: vi.fn(), success: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  can.mockImplementation(() => true);
});

const ROLES = [
  {
    role: 'CASH_CLEARING',
    purpose: 'Where money sits between a payment being recorded and the bank confirming it.',
    required: true,
    account: undefined,
  },
  {
    role: 'VAT_INPUT',
    purpose: 'Purchase VAT, from the moment it is incurred until a return claims it.',
    required: true,
    account: { id: 'a1', code: '1150', name: 'Input VAT', isActive: true },
  },
  { role: 'INVENTORY', purpose: 'The value of stock on hand.', required: false, account: undefined },
];

const ACCOUNTS = [
  { id: 'a1', code: '1150', name: 'Input VAT' },
  { id: 'a2', code: '1010', name: 'Cash Clearing' },
];

const globalOpts = {
  plugins: [createTestingPinia({ createSpy: vi.fn }), i18n, PrimeVue, ToastService, ConfirmationService],
};

async function mountPanel() {
  vi.spyOn(accountRolesApi, 'list').mockResolvedValue(structuredClone(ROLES) as never);
  vi.spyOn(accountsApi, 'selectable').mockResolvedValue(ACCOUNTS as never);
  const w = mount(AccountRoles, { global: globalOpts });
  await flushPromises();
  return w;
}

/**
 * A live company reached production with none of these mapped, every payment posting parked, and no
 * screen able to say so. What this panel owes its reader is the difference between a role that is
 * missing and one nobody needs.
 *
 * It sits on the chart-of-accounts screen rather than one of its own: a role mapping is a fact about
 * the chart it maps.
 */
describe('account roles panel', () => {
  it('marks a required role with no account as missing', async () => {
    const w = await mountPanel();
    expect(w.findAll('[data-testid="role-missing"]')).toHaveLength(1);
    expect(w.find('[data-testid="roles-missing-banner"]').exists()).toBe(true);
  });

  it('distinguishes a role nobody needs from one that is missing', async () => {
    // Fourteen roles exist and a company typically needs four; a panel that shouts about all of
    // them is one people learn to skim.
    const w = await mountPanel();
    expect(w.findAll('[data-testid="role-not-required"]')).toHaveLength(1);
    expect(w.findAll('[data-testid="role-required"]')).toHaveLength(1);
  });

  it('shows each role named and explained in the reader’s language', async () => {
    // `GRNI` names nothing to whoever has to choose an account for it — and `CASH_CLEARING` names
    // nothing in Lao either. The code stays beside it, because that is what the API and support say.
    const w = await mountPanel();
    expect(w.text()).toContain('ບັນຊີພັກເງິນຈ່າຍ');
    expect(w.text()).toContain('ບ່ອນພັກເງິນ ລະຫວ່າງທີ່ບັນທຶກການຈ່າຍແລ້ວ');
    expect(w.text()).toContain('CASH_CLEARING');
  });

  it('falls back to the server’s wording for a role the catalog has not learned', async () => {
    // A role added on the server must appear with its English purpose, not as a blank line.
    vi.spyOn(accountRolesApi, 'list').mockResolvedValue([
      { role: 'FUTURE_ROLE', purpose: 'Something the catalog has never seen.', required: false },
    ] as never);
    vi.spyOn(accountsApi, 'selectable').mockResolvedValue(ACCOUNTS as never);
    const w = mount(AccountRoles, { global: globalOpts });
    await flushPromises();

    expect(w.text()).toContain('FUTURE_ROLE');
    expect(w.text()).toContain('Something the catalog has never seen.');
  });

  it('records a chosen account from the server’s answer', async () => {
    const set = vi.spyOn(accountRolesApi, 'set').mockResolvedValue({
      role: 'CASH_CLEARING',
      purpose: ROLES[0].purpose,
      required: true,
      account: { id: 'a2', code: '1010', name: 'Cash Clearing', isActive: true },
    } as never);
    const w = await mountPanel();

    const vm = w.vm as unknown as { choose: (r: unknown, id: string) => Promise<void> };
    await vm.choose(ROLES[0], 'a2');
    await flushPromises();

    expect(set).toHaveBeenCalledWith('CASH_CLEARING', 'a2');
    // Redrawn from what was stored, not from what was clicked.
    expect(w.text()).toContain('1010');
    expect(w.find('[data-testid="roles-missing-banner"]').exists()).toBe(false);
  });

  it('offers a reader no way to change a mapping', async () => {
    can.mockImplementation((c: string) => c !== 'COA_MANAGE');
    const selectable = vi.spyOn(accountsApi, 'selectable');
    const w = await mountPanel();

    expect(w.find('[data-testid="role-select-CASH_CLEARING"]').exists()).toBe(false);
    expect(w.find('[data-testid="role-account"]').text()).toContain('1150');
    // No point fetching a picker's options for a picker that is not shown.
    expect(selectable).not.toHaveBeenCalled();
  });

  it('offers only the accounts the server would accept', async () => {
    // `selectable` is the active, postable list; offering a header account here would be refused on
    // save, which teaches people that the screen lies.
    const selectable = vi.spyOn(accountsApi, 'selectable');
    await mountPanel();
    expect(selectable).toHaveBeenCalled();
  });
});
