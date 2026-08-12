import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../../test/mountView';
import PendingVouchersView from './PendingVouchersView.vue';
import { useJournalStore } from '../../stores/journal';
import type { PendingVoucher } from '../../api/journal';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/** `mountView` seeds the auth store with userId 'user-1'. */
const MINE = 'user-1';

const voucher = (id: string, authorId: string): PendingVoucher => ({
  id,
  entryDate: '2026-06-15',
  memo: `voucher ${id}`,
  status: 'PENDING',
  reversesEntryId: null,
  createdBy: { id: authorId, username: authorId === MINE ? 'me' : 'somebody-else' },
  lines: [
    { id: `${id}-1`, account: { code: '5000', name: 'Expense' }, debit: '5000.00', credit: '0' },
    { id: `${id}-2`, account: { code: '1000', name: 'Cash' }, debit: '0', credit: '5000.00' },
  ],
});

const VOUCHERS = [voucher('v-mine', MINE), voucher('v-theirs', 'user-2')];

async function mount(permissions: string[], pendingVouchers = VOUCHERS) {
  const w = await mountView(PendingVouchersView, {
    path: '/journal/vouchers/pending',
    routeName: 'pending-vouchers',
    permissions,
    initialState: { journal: { pendingVouchers } },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const inBody = (testid: string) => document.body.querySelector(`[data-testid="${testid}"]`);

describe('PendingVouchersView', () => {
  it('lists what is waiting with its total', async () => {
    const w = await mount(['GL_VIEW']);
    expect(w.text()).toContain('voucher v-mine');
    expect(w.findAll('[data-testid="voucher-total"]')[0].text()).toBe('5,000.00');
  });

  it('offers no approve or reject control without GL_JV_APPROVE', async () => {
    const w = await mount(['GL_VIEW']);
    expect(w.find('[data-testid="approve-voucher"]').exists()).toBe(false);
    expect(w.find('[data-testid="open-reject"]').exists()).toBe(false);
  });

  it('offers them to a holder of the approval code', async () => {
    const w = await mount(['GL_VIEW', 'GL_JV_APPROVE']);
    expect(w.findAll('[data-testid="approve-voucher"]')).toHaveLength(2);
  });

  it('marks a viewer own voucher rather than hiding its approve control', async () => {
    // The server refuses self-approval and its refusal is the one that matters. Hiding the button
    // would make a rule look like a missing feature.
    const w = await mount(['GL_VIEW', 'GL_JV_APPROVE']);
    expect(w.findAll('[data-testid="own-voucher"]')).toHaveLength(1);
    expect(w.findAll('[data-testid="approve-voucher"]')).toHaveLength(2);
  });

  it('offers withdraw only on the viewer own voucher', async () => {
    const w = await mount(['GL_VIEW', 'GL_JV_APPROVE']);
    expect(w.findAll('[data-testid="withdraw-voucher"]')).toHaveLength(1);
  });

  it('keeps the reject confirm disabled until a reason is given', async () => {
    const w = await mount(['GL_VIEW', 'GL_JV_APPROVE']);
    await w.findAll('[data-testid="open-reject"]')[0].trigger('click');
    await flushPromises();

    expect((inBody('confirm-reject') as HTMLButtonElement).disabled).toBe(true);
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'wrong expense account';
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();
    expect((inBody('confirm-reject') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the server refusal when self-approval is attempted', async () => {
    const w = await mount(['GL_VIEW', 'GL_JV_APPROVE']);
    const store = useJournalStore();
    const refusal = 'A voucher cannot be approved by the person who submitted it';
    vi.mocked(store.approveVoucher).mockImplementation(async () => {
      store.error = refusal;
      return false;
    });

    await w.findAll('[data-testid="approve-voucher"]')[0].trigger('click');
    await flushPromises();
    expect(store.approveVoucher).toHaveBeenCalledWith('v-mine');
    expect(store.error).toBe(refusal);
  });
});
