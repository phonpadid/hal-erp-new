import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Tooltip from 'primevue/tooltip';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { BANKS } from '../../shared/banks';
import VendorBankAccountsPanel from './VendorBankAccountsPanel.vue';
import type { VendorBankAccount } from '../../api/masterData';

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const setPrimary = vi.fn();
const deactivate = vi.fn();
const history = vi.fn();

vi.mock('../../api/masterData', () => ({
  masterDataApi: {
    vendorBankAccounts: {
      list: (...a: unknown[]) => list(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      setPrimary: (...a: unknown[]) => setPrimary(...a),
      deactivate: (...a: unknown[]) => deactivate(...a),
      history: (...a: unknown[]) => history(...a),
    },
  },
}));

const can = vi.fn((_c: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c) }) }));

// The currency picker reads the active list from the store; the panel loads it on mount.
const loadSelectableCurrencies = vi.fn();
vi.mock('../../stores/currency', () => ({
  useCurrencyStore: () => ({
    selectableCurrencies: [
      { code: 'LAK', name: 'Lao Kip', symbol: '₭', decimalPlaces: 0 },
      { code: 'THB', name: 'Thai Baht', symbol: '฿', decimalPlaces: 2 },
    ],
    loadSelectableCurrencies: () => loadSelectableCurrencies(),
  }),
}));

const errorFn = vi.fn();
vi.mock('../../composables/useFeedback', () => ({
  useFeedback: () => ({ success: vi.fn(), error: errorFn, confirm: vi.fn(() => Promise.resolve(true)) }),
}));

const global = { plugins: [i18n, PrimeVue], directives: { tooltip: Tooltip } };

function account(over: Partial<VendorBankAccount> = {}): VendorBankAccount {
  return {
    id: 'a1',
    bankCode: 'BCEL',
    accountNo: '0101234567',
    accountName: 'Acme Supplies',
    isPrimary: true,
    isActive: true,
    ...over,
  };
}

function panel() {
  return mount(VendorBankAccountsPanel, {
    props: { vendorId: 'v1', vendorName: 'Acme' },
    global,
  });
}

/** `<script setup>` bindings are reachable through the setup-state proxy. */
function setup(w: ReturnType<typeof panel>) {
  return (w.vm.$ as unknown as { setupState: Record<string, any> }).setupState;
}

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });
// Dialogs teleport to <body>, so a wrapper left mounted keeps its dialog in the document and stays
// reactive over nodes the next test would otherwise clear out from under it — which is how a live
// component ends up patching into a tree with no parent. Unmounting takes the teleported nodes too.
enableAutoUnmount(afterEach);
beforeEach(() => {
  for (const m of [list, create, update, setPrimary, deactivate, history, can, errorFn]) m.mockReset();
  can.mockReturnValue(true);
  list.mockResolvedValue([account()]);
});

/**
 * The vendor bank-account panel.
 *
 * This is the fraud surface the server's separate `VENDOR_BANK_MANAGE` permission exists to
 * protect: redirecting a payee needs no approval, leaves no document, and pays out on the next run.
 * The tests that matter most here are the negative ones.
 */
describe('VendorBankAccountsPanel — permission gating', () => {
  it('shows no mutation affordance to a vendor editor without VENDOR_BANK_MANAGE', async () => {
    // MASTER_MANAGE is the right to fix a typo in a vendor's name — not to move its money.
    can.mockImplementation((c: string) => c !== 'VENDOR_BANK_MANAGE');
    const w = panel();
    await flushPromises();

    expect(w.find('[data-testid="add-account"]').exists()).toBe(false);
    expect(w.find('[data-testid="edit-account"]').exists()).toBe(false);
    expect(w.find('[data-testid="make-primary"]').exists()).toBe(false);
    expect(w.find('[data-testid="deactivate-account"]').exists()).toBe(false);
    // Absent, not disabled: a control that exists but refuses reads as a bug, not a boundary.
    expect(w.find('[data-testid="open-history"]').exists()).toBe(false);
  });

  it('still lists the accounts read-only for that user', async () => {
    can.mockImplementation((c: string) => c !== 'VENDOR_BANK_MANAGE');
    const w = panel();
    await flushPromises();

    expect(w.text()).toContain('0101234567');
  });

  it('shows the full surface to a VENDOR_BANK_MANAGE user', async () => {
    const w = panel();
    await flushPromises();

    expect(w.find('[data-testid="add-account"]').exists()).toBe(true);
    expect(w.find('[data-testid="edit-account"]').exists()).toBe(true);
    expect(w.find('[data-testid="open-history"]').exists()).toBe(true);
  });
});

describe('VendorBankAccountsPanel — listing', () => {
  it('renders an account number as text, keeping its leading zeros', async () => {
    list.mockResolvedValue([account({ accountNo: '000123' })]);
    const w = panel();
    await flushPromises();

    // As a number this is 123 — a different account.
    expect(w.text()).toContain('000123');
  });

  it('marks the primary account', async () => {
    const w = panel();
    await flushPromises();

    // It is what a disbursement's payee picker preselects, so it has to be legible here.
    expect(w.find('[data-testid="primary-tag"]').exists()).toBe(true);
  });

  it('keeps a deactivated account visible rather than hiding it', async () => {
    list.mockResolvedValue([account({ isActive: false, isPrimary: false })]);
    const w = panel();
    await flushPromises();

    // An old document naming it must stay traceable.
    expect(w.find('[data-testid="inactive-tag"]').exists()).toBe(true);
    expect(w.text()).toContain('0101234567');
  });

  it('explains an empty list in terms of what it blocks', async () => {
    list.mockResolvedValue([]);
    const w = panel();
    await flushPromises();

    expect(w.text()).toContain('cannot be submitted until it has an account');
  });
});

describe('VendorBankAccountsPanel — add and edit', () => {
  it('has no primary field on the form', async () => {
    const w = panel();
    await flushPromises();
    setup(w).newAccount();
    await flushPromises();

    // Promoting is its own action: the server demotes the previous primary atomically, and a field
    // would imply two could be primary between saves.
    expect(w.html()).not.toContain('name="isPrimary"');
  });

  it('reports a duplicate by naming the clash', async () => {
    create.mockRejectedValue({ response: { status: 409 } });
    const w = panel();
    await flushPromises();

    await setup(w).submit({
      valid: true,
      values: { bankCode: 'BCEL', accountNo: '0101234567', accountName: 'Acme' },
    });
    await flushPromises();

    expect(errorFn).toHaveBeenCalledWith(expect.stringContaining('0101234567'));
    expect(errorFn).toHaveBeenCalledWith(expect.stringContaining('BCEL'));
  });

  it('does not submit an invalid form', async () => {
    const w = panel();
    await flushPromises();

    await setup(w).submit({ valid: false, values: {} });

    expect(create).not.toHaveBeenCalled();
  });

  it('omits an empty currency rather than sending a blank', async () => {
    create.mockResolvedValue(account());
    const w = panel();
    await flushPromises();

    await setup(w).submit({
      valid: true,
      values: { bankCode: 'BCEL', accountNo: '1', accountName: 'A', currency: '' },
    });

    expect(create).toHaveBeenCalledWith('v1', expect.objectContaining({ currency: undefined }));
  });

  it('shows the bank logo beside the account in the list', async () => {
    const w = panel();
    await flushPromises();

    const logo = w.find('td img');
    expect(logo.attributes('src')).toContain('banks/bcel.png');
    // The identifier still reads in full — the logo is recognition, the number is what is checked.
    expect(w.text()).toContain('BCEL · 0101234567');
  });

  it('shows no logo for a bank the catalog does not know', async () => {
    list.mockResolvedValue([account({ bankCode: 'SOME OLD BANK' })]);
    const w = panel();
    await flushPromises();

    expect(w.find('td img').exists()).toBe(false);
    expect(w.text()).toContain('SOME OLD BANK · 0101234567');
  });

  it('picks the bank and the currency rather than accepting typed text', async () => {
    const w = panel();
    await flushPromises();
    setup(w).newAccount();
    await flushPromises();

    // A typed bank defeats the (vendor_id, bank_code, account_no) uniqueness the server relies on.
    expect(document.querySelector('[data-testid="bank-select"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="currency-select"]')).toBeTruthy();
    // The account number is still typed — and still text, so 000123 stays 000123.
    expect(document.querySelector('[data-testid="account-no-input"]')).toBeTruthy();
  });

  it('offers the catalog banks by code, and no stray value, when adding', async () => {
    const w = panel();
    await flushPromises();
    setup(w).newAccount();
    await flushPromises();

    const values = setup(w).bankChoices.map((o: { value: string }) => o.value);
    expect(values).toContain('BCEL');
    expect(values).toContain('ACLEDA');
    expect(values).toEqual(BANKS.map((b) => b.code));
  });

  it('keeps a stored bank the catalog does not know selectable when editing', async () => {
    const w = panel();
    await flushPromises();
    setup(w).editAccount(account({ bankCode: 'SOME OLD BANK' }));
    await flushPromises();

    // Otherwise the <Select> renders blank and saving silently rebanks the account.
    expect(setup(w).bankChoices.at(-1)).toEqual({ value: 'SOME OLD BANK', label: 'SOME OLD BANK' });
    expect(setup(w).dialog.initial.bankCode).toBe('SOME OLD BANK');
  });

  it('sends the stored bank back unchanged when only the number is edited', async () => {
    update.mockResolvedValue(account());
    const w = panel();
    await flushPromises();
    setup(w).editAccount(account({ bankCode: 'SOME OLD BANK' }));

    await setup(w).submit({
      valid: true,
      values: { bankCode: 'SOME OLD BANK', accountNo: '0101234568', accountName: 'Acme Supplies' },
    });

    expect(update).toHaveBeenCalledWith('v1', 'a1', expect.objectContaining({ bankCode: 'SOME OLD BANK' }));
  });

  it('sends the picked bank as a code, one string, unchanged in shape', async () => {
    create.mockResolvedValue(account());
    const w = panel();
    await flushPromises();

    await setup(w).submit({
      valid: true,
      values: { bankCode: 'ACLEDA', accountNo: '1', accountName: 'A', currency: 'LAK' },
    });

    expect(create).toHaveBeenCalledWith('v1', {
      bankCode: 'ACLEDA', accountNo: '1', accountName: 'A', currency: 'LAK',
    });
  });
});

describe('VendorBankAccountsPanel — promote and deactivate', () => {
  it('offers no promote on the account that is already primary', async () => {
    const w = panel();
    await flushPromises();

    expect(w.find('[data-testid="make-primary"]').exists()).toBe(false);
  });

  it('offers no promote on an inactive account', async () => {
    list.mockResolvedValue([account({ isPrimary: false, isActive: false })]);
    const w = panel();
    await flushPromises();

    // The server refuses it, so the UI must not suggest it.
    expect(w.find('[data-testid="make-primary"]').exists()).toBe(false);
  });

  it('promotes an active non-primary account', async () => {
    list.mockResolvedValue([account({ id: 'a2', isPrimary: false })]);
    setPrimary.mockResolvedValue(account());
    const w = panel();
    await flushPromises();

    await w.find('[data-testid="make-primary"]').trigger('click');
    await flushPromises();

    expect(setPrimary).toHaveBeenCalledWith('v1', 'a2');
    // Reloads, so the demotion the server performed is what gets rendered.
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('warns that deactivating the primary leaves the vendor with none', async () => {
    const w = panel();
    await flushPromises();

    await w.find('[data-testid="deactivate-account"]').trigger('click');
    await flushPromises();

    // The Dialog teleports to body; assert on the document.
    // The person deactivating is not the person who discovers the payee picker is empty.
    expect(document.body.querySelector('[data-testid="primary-warning"]')).toBeTruthy();
  });

  it('does not warn when the account is not the primary', async () => {
    list.mockResolvedValue([account({ isPrimary: false })]);
    const w = panel();
    await flushPromises();

    await w.find('[data-testid="deactivate-account"]').trigger('click');
    await flushPromises();

    expect(document.body.querySelector('[data-testid="primary-warning"]')).toBeNull();
  });

  it('offers no deactivate on an already inactive account', async () => {
    list.mockResolvedValue([account({ isActive: false })]);
    const w = panel();
    await flushPromises();

    expect(w.find('[data-testid="deactivate-account"]').exists()).toBe(false);
  });

  it('offers no delete anywhere', async () => {
    const w = panel();
    await flushPromises();

    // Deactivate only: a document or exported batch naming the account must stay legible.
    expect(w.html()).not.toContain('pi-trash');
  });
});

describe('VendorBankAccountsPanel — history', () => {
  it('shows who changed an account and from what to what', async () => {
    history.mockResolvedValue([
      {
        id: 'h1',
        action: 'UPDATE',
        actor: { id: 'u1', username: 'bankadmin' },
        actedAt: '2026-07-16T10:00:00Z',
        before: { bankCode: 'BCEL', accountNo: '0001', accountName: 'Acme' },
        after: { bankCode: 'BCEL', accountNo: '9999', accountName: 'Acme' },
      },
    ]);
    const w = panel();
    await flushPromises();

    await w.find('[data-testid="open-history"]').trigger('click');
    await flushPromises();

    const text = document.body.textContent ?? '';
    expect(text).toContain('bankadmin');
    expect(text).toContain('0001');
    expect(text).toContain('9999');
  });

  it('makes an edit-pay-revert legible', async () => {
    history.mockResolvedValue([
      { id: 'h3', action: 'UPDATE', actor: { id: 'u1', username: 'bankadmin' }, before: { bankCode: 'BCEL', accountNo: 'ATTACKER', accountName: 'Acme' }, after: { bankCode: 'BCEL', accountNo: '0001', accountName: 'Acme' } },
      { id: 'h2', action: 'UPDATE', actor: { id: 'u1', username: 'bankadmin' }, before: { bankCode: 'BCEL', accountNo: '0001', accountName: 'Acme' }, after: { bankCode: 'BCEL', accountNo: 'ATTACKER', accountName: 'Acme' } },
      { id: 'h1', action: 'CREATE', actor: { id: 'u1', username: 'bankadmin' }, before: null, after: { bankCode: 'BCEL', accountNo: '0001', accountName: 'Acme' } },
    ]);
    const w = panel();
    await flushPromises();

    await w.find('[data-testid="open-history"]').trigger('click');
    await flushPromises();

    // The account now reads exactly as it started; the history is the only thing that says the
    // money briefly pointed somewhere else.
    expect(document.body.querySelectorAll('[data-testid="history-entry"]')).toHaveLength(3);
    expect(document.body.textContent).toContain('ATTACKER');
  });

  it('says so when nothing was ever changed', async () => {
    history.mockResolvedValue([]);
    const w = panel();
    await flushPromises();

    await w.find('[data-testid="open-history"]').trigger('click');
    await flushPromises();

    expect(document.body.textContent).toContain('No changes recorded');
  });
});
