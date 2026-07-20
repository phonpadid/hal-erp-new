import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePayeeAccounts } from './usePayeeAccounts';

const list = vi.fn();
vi.mock('../api/masterData', () => ({
  masterDataApi: { vendorBankAccounts: { list: (...a: unknown[]) => list(...a) } },
}));

const ACCOUNTS = [
  { id: 'a-primary', bankCode: 'BKK', accountNo: '0001', accountName: 'Acme Co', isPrimary: true, isActive: true },
  { id: 'a-second', bankCode: 'SCB', accountNo: '0002', accountName: 'Acme Co 2', isPrimary: false, isActive: true },
  { id: 'a-dead', bankCode: 'KTB', accountNo: '0003', accountName: 'Acme old', isPrimary: false, isActive: false },
];

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue(ACCOUNTS);
});

/**
 * The payee picker's rules.
 *
 * The server enforces all of this at submit — an inactive account, or one of another vendor, is
 * rejected there. These rules only decide what the requester is offered, and above all that a payee
 * from a previous vendor can never leak into the payload.
 */
describe('usePayeeAccounts', () => {
  it('offers only the vendor’s ACTIVE accounts', async () => {
    const vendorId = ref('v1');
    const { options, load } = usePayeeAccounts(vendorId, ref(true));

    await load();

    // A deactivated account stays readable on old documents but must never be newly selectable.
    expect(options.value.map((o) => o.value)).toEqual(['a-primary', 'a-second']);
  });

  it('preselects the vendor’s primary account', async () => {
    const { selectedId, load } = usePayeeAccounts(ref('v1'), ref(true));

    await load();

    expect(selectedId.value).toBe('a-primary');
  });

  it('preselects nothing when the primary is inactive', async () => {
    list.mockResolvedValue([{ ...ACCOUNTS[0], isActive: false }, ACCOUNTS[1]]);
    const { selectedId, load } = usePayeeAccounts(ref('v1'), ref(true));

    await load();

    // Defaulting to a closed account would only fail at submit, after the requester filled the form.
    expect(selectedId.value).toBe('');
  });

  it('renders the account number as text, keeping its leading zeros', async () => {
    const { options, load } = usePayeeAccounts(ref('v1'), ref(true));

    await load();

    // As a number, 0001 would render as 1 — a different account entirely.
    expect(options.value[0].label).toContain('0001');
  });

  it('clears the payee when the vendor changes', async () => {
    const vendorId = ref('v1');
    const { selectedId, load } = usePayeeAccounts(vendorId, ref(true));
    await load();
    expect(selectedId.value).toBe('a-primary');

    list.mockResolvedValue([]);
    vendorId.value = 'v2';
    await load();

    // An account of the old vendor fails the server's gate; carrying it silently would be a payee
    // nobody chose.
    expect(selectedId.value).toBe('');
  });

  it('reloads when the vendor ref changes, without an explicit call', async () => {
    const vendorId = ref('v1');
    usePayeeAccounts(vendorId, ref(true));

    vendorId.value = 'v2';
    await Promise.resolve();
    await Promise.resolve();

    expect(list).toHaveBeenCalledWith('v2');
  });

  it('loads nothing when there is no vendor yet', async () => {
    const { options, load } = usePayeeAccounts(ref(''), ref(true));

    await load();

    expect(list).not.toHaveBeenCalled();
    expect(options.value).toEqual([]);
  });

  it('loads nothing for a user who cannot read master data', async () => {
    const { load } = usePayeeAccounts(ref('v1'), ref(false));

    await load();

    // Without the picker the server stays authoritative; the client simply does not offer it.
    expect(list).not.toHaveBeenCalled();
  });

  it('stays usable when the accounts cannot be loaded', async () => {
    list.mockRejectedValue(new Error('boom'));
    const { options, selectedId, load } = usePayeeAccounts(ref('v1'), ref(true));

    await load();

    // The form must not break on a failed lookup — submit will still be refused server-side.
    expect(options.value).toEqual([]);
    expect(selectedId.value).toBe('');
  });
});
