import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateGuard } from '../../router';
import { mountView } from '../../test/mountView';
import JournalVoucherView from './JournalVoucherView.vue';
import { useJournalStore } from '../../stores/journal';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

const guard = (codes: string[], permission: string) =>
  evaluateGuard(
    { isAuthenticated: true, hasCompany: true, can: (c: string) => codes.includes(c) },
    { name: 'target', meta: { permission } },
  );

async function mount(permissions = ['GL_JV_POST']) {
  const w = await mountView(JournalVoucherView, {
    path: '/journal/voucher',
    routeName: 'journal-voucher',
    permissions,
    extraRoutes: [{ path: '/journal', name: 'journal' }],
  });
  await flushPromises();
  wrapper = w;
  return w;
}

/** Text inputs, in row order: [account, debit, credit, memo] per line. */
const lineInputs = (w: VueWrapper, index: number) => {
  const inputs = w.findAll('tbody input[type="text"]');
  const perLine = 4;
  return {
    account: inputs[index * perLine],
    debit: inputs[index * perLine + 1],
    credit: inputs[index * perLine + 2],
  };
};

/** Fill both lines so only the amounts decide whether the submit is allowed. */
async function fillVoucher(w: VueWrapper, amounts: Array<{ debit: string; credit: string }>) {
  await w.find('[data-testid="voucher-memo"]').setValue('depreciation, august');
  for (const [i, a] of amounts.entries()) {
    const l = lineInputs(w, i);
    await l.account.setValue(i === 0 ? '5000' : '1500');
    await l.debit.setValue(a.debit);
    await l.credit.setValue(a.credit);
  }
  await flushPromises();
}

const submitDisabled = (w: VueWrapper) =>
  (w.find('[data-testid="post-voucher"]').element as HTMLButtonElement).disabled;

describe('route gating', () => {
  it('keeps the voucher form from someone who cannot post to the ledger', () => {
    expect(guard(['GL_VIEW'], 'GL_JV_POST')).toBe('home');
  });

  it('lets a GL_JV_POST holder through', () => {
    expect(guard(['GL_JV_POST'], 'GL_JV_POST')).toBeNull();
  });
});

describe('JournalVoucherView', () => {
  it('enables the submit for a balanced, non-zero voucher', async () => {
    const w = await mount();
    await fillVoucher(w, [
      { debit: '1000.00', credit: '0' },
      { debit: '0', credit: '1000.00' },
    ]);
    expect(submitDisabled(w)).toBe(false);
  });

  it('refuses an unbalanced voucher', async () => {
    const w = await mount();
    await fillVoucher(w, [
      { debit: '1000.00', credit: '0' },
      { debit: '0', credit: '900.00' },
    ]);
    expect(submitDisabled(w)).toBe(true);
    expect(w.find('[data-testid="not-balanced"]').exists()).toBe(true);
  });

  it('refuses an all-zero voucher even though it balances', async () => {
    // Asserted apart from the unbalanced case: a form that only compares the two totals passes
    // that one and posts an entry saying nothing.
    const w = await mount();
    await fillVoucher(w, [
      { debit: '0', credit: '0' },
      { debit: '0', credit: '0' },
    ]);
    expect(submitDisabled(w)).toBe(true);
    expect(w.find('[data-testid="all-zero"]').exists()).toBe(true);
  });

  it('sums in decimals, not floats, and shows the total at the currency’s places', async () => {
    // 0.10 + 0.20 is 0.30000000000000004 as a float; the bare Decimal is '0.3'. Neither is what a
    // total should read as.
    const w = await mount();
    await fillVoucher(w, [
      { debit: '0.10', credit: '0' },
      { debit: '0.20', credit: '0' },
    ]);
    expect(w.find('[data-testid="debit-total"]').text()).toBe('0.30');
  });

  it('refuses a line carrying both a debit and a credit', async () => {
    const w = await mount();
    await fillVoucher(w, [
      { debit: '1000.00', credit: '1000.00' },
      { debit: '0', credit: '0' },
    ]);
    expect(submitDisabled(w)).toBe(true);
    expect(w.find('[data-testid="two-sided-warning"]').exists()).toBe(true);
    expect(w.find('[data-testid="line-two-sided"]').exists()).toBe(true);
  });

  it('adds lines, and refuses to remove below two', async () => {
    const w = await mount();
    expect(w.findAll('[data-testid="remove-line"]')).toHaveLength(2);
    // At two, every remove control is disabled — one line is a mistake caught before the ledger.
    for (const b of w.findAll('[data-testid="remove-line"]')) {
      expect((b.element as HTMLButtonElement).disabled).toBe(true);
    }

    await w.find('[data-testid="add-line"]').trigger('click');
    await flushPromises();
    expect(w.findAll('[data-testid="remove-line"]')).toHaveLength(3);
    expect((w.findAll('[data-testid="remove-line"]')[0].element as HTMLButtonElement).disabled).toBe(false);

    await w.findAll('[data-testid="remove-line"]')[0].trigger('click');
    await flushPromises();
    expect(w.findAll('[data-testid="remove-line"]')).toHaveLength(2);
  });

  it('sends the same id when the same voucher is submitted twice', async () => {
    const w = await mount();
    const store = useJournalStore();
    // A failed submit keeps the id: correcting a typo and resubmitting must not produce two vouchers.
    vi.mocked(store.submitVoucher).mockResolvedValue(false);
    await fillVoucher(w, [
      { debit: '1000.00', credit: '0' },
      { debit: '0', credit: '1000.00' },
    ]);

    await w.find('[data-testid="post-voucher"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="post-voucher"]').trigger('click');
    await flushPromises();

    const calls = vi.mocked(store.submitVoucher).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].id).toBe(calls[1][0].id);
  });

  it('mints a new id after a successful submit', async () => {
    const w = await mount();
    const store = useJournalStore();
    vi.mocked(store.submitVoucher).mockResolvedValue(true);
    await fillVoucher(w, [
      { debit: '1000.00', credit: '0' },
      { debit: '0', credit: '1000.00' },
    ]);

    await w.find('[data-testid="post-voucher"]').trigger('click');
    await flushPromises();
    await w.find('[data-testid="post-voucher"]').trigger('click');
    await flushPromises();

    const calls = vi.mocked(store.submitVoucher).mock.calls;
    expect(calls[0][0].id).not.toBe(calls[1][0].id);
  });

  it('offers the account picker only with COA_VIEW', async () => {
    // The code input is always typeable — the server resolves it — so nobody is blocked.
    const without = await mount(['GL_JV_POST']);
    expect(without.findComponent({ name: 'Select' }).exists()).toBe(false);
    expect(without.findAll('tbody input[type="text"]').length).toBeGreaterThan(0);
    without.unmount();

    const w = await mount(['GL_JV_POST', 'COA_VIEW']);
    expect(w.findComponent({ name: 'Select' }).exists()).toBe(true);
  });
});
