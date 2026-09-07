import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import ConfirmationService from 'primevue/confirmationservice';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import PaymentSlips from './PaymentSlips.vue';

const list = vi.fn();
const upload = vi.fn();
const stateRate = vi.fn();
const remove = vi.fn();
vi.mock('../../api/payments', () => ({
  paymentsApi: {
    slips: {
      list: (...a: unknown[]) => list(...a),
      upload: (...a: unknown[]) => upload(...a),
      remove: (...a: unknown[]) => remove(...a),
      downloadUrl: vi.fn(),
      stateRate: (...a: unknown[]) => stateRate(...a),
    },
  },
  // The real pair, not a stand-in: the options offered here must be the ones the server validates.
  TRANSFER_SOURCES: ['PRIMARY', 'RESERVE'] as const,
}));
const can = vi.fn((_code: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c) }) }));
vi.mock('../../composables/useFeedback', () => ({
  useFeedback: () => ({ error: vi.fn(), success: vi.fn() }),
}));

// Pinia is needed because the panel formats base-currency amounts (the rate-effect note), which
// resolves the company's decimal places from the currency store.
const global = {
  plugins: [
    createTestingPinia({
      createSpy: vi.fn,
      initialState: {
        auth: { baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
        currency: { currencies: [{ code: 'LAK', decimalPlaces: 0 }] },
      },
    }),
    i18n,
    PrimeVue,
    ToastService,
    ConfirmationService,
  ],
};
const SLIP = { id: 's1', fileName: 'slip.png', fileSizeKb: 12 };

/** The panel refuses to attach anything until the account is named, so most cases start by naming it. */
type Vm = {
  onUpload: (e: { files: File[] }) => Promise<void>;
  saveRate: () => Promise<void>;
  transferFrom?: string;
  actualRate: string;
  rateIsDirty: boolean;
};
const stating = (w: { vm: unknown }, src = 'PRIMARY', rate = '1.05') => {
  const vm = w.vm as Vm;
  vm.transferFrom = src;
  vm.actualRate = rate;
  return vm;
};

const mountPanel = async () => {
  const w = mount(PaymentSlips, { props: { documentId: 'd1' }, global });
  await flushPromises();
  return w;
};

describe('PaymentSlips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockImplementation((_c: string) => true);
  });

  it('lists a payment’s slips, keyed by document', async () => {
    list.mockResolvedValue([SLIP]);
    const w = await mountPanel();
    expect(list).toHaveBeenCalledWith('d1');
    expect(w.find('[data-testid="slip-list"]').text()).toContain('slip.png');
    expect(w.find('[data-testid="no-slips"]').exists()).toBe(false);
  });

  it('says so when nothing is attached rather than rendering an empty area', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    expect(w.find('[data-testid="no-slips"]').exists()).toBe(true);
  });

  // Whether a document HAS a payment is now the caller's business, answered by `hasPayment` on
  // the detail response, so this panel is only mounted when there is evidence to read. What it
  // owes in return is to stop reading every rejection as an absence: a 500 used to hide the
  // panel of a document that does have evidence, and say nothing.
  it('shows a failed read as a failure rather than emitting absence', async () => {
    list.mockRejectedValue({ response: { status: 500 } });
    const w = await mountPanel();
    expect(w.emitted('absent')).toBeFalsy();
    expect(w.find('[data-testid="slips-failed"]').exists()).toBe(true);
    expect(w.find('[data-testid="no-slips"]').exists()).toBe(false);
  });

  it('uploads against the document it was opened from and reloads', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    upload.mockResolvedValue(SLIP);
    list.mockResolvedValue([SLIP]);

    const file = new File(['x'], 'slip.png', { type: 'image/png' });
    const vm = stating(w);
    await vm.onUpload({ files: [file] });
    await flushPromises();

    // The statement travels WITH the file: which account paid and at what rate are known now,
    // not later.
    expect(upload).toHaveBeenCalledWith('d1', file, { transferFrom: 'PRIMARY', actualRate: '1.05' });
    expect(list).toHaveBeenCalledTimes(2); // reloaded after the upload
  });

  it('attaches every file of a multi-file pick', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    upload.mockResolvedValue(SLIP);
    const a = new File(['a'], 'a.png');
    const b = new File(['b'], 'b.pdf');

    const vm = stating(w);
    await vm.onUpload({ files: [a, b] });
    await flushPromises();

    expect(upload).toHaveBeenCalledTimes(2);
  });

  // The client guard is UX only, but it must mirror the server's codes.
  it('hides the upload control without PAYMENT_MANAGE', async () => {
    can.mockImplementation((c: string) => c !== 'PAYMENT_MANAGE');
    list.mockResolvedValue([SLIP]);
    const w = await mountPanel();
    expect(w.find('[data-testid="slip-upload"]').exists()).toBe(false);
    expect(w.find('[data-testid="slip-list"]').exists()).toBe(true);
  });

  it('hides the delete control without PAYMENT_SLIP_DELETE, which PAYMENT_MANAGE does not imply', async () => {
    can.mockImplementation((c: string) => c === 'PAYMENT_MANAGE' || c === 'PAYMENT_VIEW');
    list.mockResolvedValue([SLIP]);
    const w = await mountPanel();
    expect(w.find('[data-testid="slip-delete"]').exists()).toBe(false);
    // Recording a payment still lets you attach one.
    expect(w.find('[data-testid="slip-upload"]').exists()).toBe(true);
  });

  it('deletes a slip and reloads', async () => {
    list.mockResolvedValue([SLIP]);
    const w = await mountPanel();
    remove.mockResolvedValue(undefined);
    list.mockResolvedValue([]);

    await w.find('[data-testid="slip-delete"]').trigger('click');
    await flushPromises();

    expect(remove).toHaveBeenCalledWith('d1', 's1');
    expect(w.find('[data-testid="no-slips"]').exists()).toBe(true);
  });

  // ---- Which of the company's own accounts the transfer left -----------------
  //
  // Asked HERE because here is when it is known: whoever attaches the slip is whoever paid, and
  // they are looking at the transfer as they do it. The record-payment screen later adopts what
  // was said rather than asking again.

  it('asks which account the money left, beside the upload control', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    expect(w.find('[data-testid="slip-transfer-from"]').exists()).toBe(true);
    expect(w.find('[data-testid="slip-transfer-from-PRIMARY"]').exists()).toBe(true);
    expect(w.find('[data-testid="slip-transfer-from-RESERVE"]').exists()).toBe(true);
  });

  it('will not attach anything until the account is named', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    // Said on screen, not merely enforced: a disabled control with no reason reads as broken.
    expect(w.find('[data-testid="slip-transfer-from-required"]').exists()).toBe(true);

    const vm = w.vm as unknown as Vm;
    vm.actualRate = '1.05';
    await vm.onUpload({ files: [new File(['x'], 'slip.png')] });
    await flushPromises();
    expect(upload).not.toHaveBeenCalled();
  });

  it('carries forward what an earlier slip said, so a second one confirms rather than re-asks', async () => {
    list.mockResolvedValue([{ ...SLIP, transferFrom: 'RESERVE' }]);
    const w = await mountPanel();
    expect((w.vm as unknown as Vm).transferFrom).toBe('RESERVE');
    expect(w.find('[data-testid="slip-transfer-from-required"]').exists()).toBe(false);
  });

  it('shows what each slip stated, beside the file', async () => {
    list.mockResolvedValue([{ ...SLIP, transferFrom: 'RESERVE' }]);
    const w = await mountPanel();
    expect(w.find('[data-testid="slip-stated-account"]').text()).toBe(
      i18n.global.t('payments.record.transferFrom.RESERVE'),
    );
  });

  it('says nothing about an account for a slip that stated none', async () => {
    list.mockResolvedValue([SLIP]);
    const w = await mountPanel();
    expect(w.find('[data-testid="slip-stated-account"]').exists()).toBe(false);
  });

  // ---- The rate the money actually converted at ------------------------------
  //
  // Asked here for the same reason as the account: the bank's rate for the day is on the slip in
  // the hand of whoever paid. Started from the document's locked rate so they correct a figure
  // rather than retype one, and editable because the bank decides it, not the document.

  it('starts the rate at the document’s locked rate, trimmed of its scale', async () => {
    // NUMERIC(_, 8) reads back `26.50000000`; the field offers `26.50`, because the person is here
    // to check a figure. Zeros only — nothing is rounded away.
    list.mockResolvedValue([]);
    const w = mount(PaymentSlips, { props: { documentId: 'd1', lockedRate: '26.50000000' }, global });
    await flushPromises();
    expect((w.vm as unknown as Vm).actualRate).toBe('26.50');
  });

  it('prefers what an earlier slip said over the locked rate', async () => {
    list.mockResolvedValue([{ ...SLIP, actualRate: '27.25000000' }]);
    const w = mount(PaymentSlips, { props: { documentId: 'd1', lockedRate: '26.50000000' }, global });
    await flushPromises();
    expect((w.vm as unknown as Vm).actualRate).toBe('27.25');
  });

  it('leaves the rate empty when the caller knows no locked rate', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    // Never a figure this screen invented: an empty field asks, a "1" would assert.
    expect((w.vm as unknown as Vm).actualRate).toBe('');
    expect(w.find('[data-testid="slip-actual-rate-required"]').exists()).toBe(true);
  });

  it('will not attach anything until the rate is a positive number', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    const vm = w.vm as unknown as Vm;
    vm.transferFrom = 'PRIMARY';

    for (const bad of ['', '  ', '0', '-1', 'abc']) {
      vm.actualRate = bad;
      await vm.onUpload({ files: [new File(['x'], 'slip.png')] });
    }
    await flushPromises();
    expect(upload).not.toHaveBeenCalled();

    vm.actualRate = '1.05';
    await vm.onUpload({ files: [new File(['x'], 'slip.png')] });
    await flushPromises();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('sends the edited rate, not the one it started from', async () => {
    list.mockResolvedValue([]);
    const w = mount(PaymentSlips, { props: { documentId: 'd1', lockedRate: '26.5' }, global });
    await flushPromises();
    upload.mockResolvedValue(SLIP);

    const vm = stating(w, 'RESERVE', '27.25');
    const f = new File(['x'], 'slip.png');
    await vm.onUpload({ files: [f] });
    await flushPromises();

    expect(upload).toHaveBeenCalledWith('d1', f, { transferFrom: 'RESERVE', actualRate: '27.25' });
  });

  /**
   * The rate does NOT restate the document — its rate is stamped at submit and never recomputed
   * (invariant 6). That is correct and invisible, and the invisibility is what made a working
   * system look broken: finance typed 30000, every figure on the page stayed put, and nothing said
   * why. These pin the sentence that explains it.
   */
  it('says what a different rate will record, and what it leaves alone', async () => {
    list.mockResolvedValue([]);
    const w = mount(PaymentSlips, {
      props: { documentId: 'd1', lockedRate: '23000.00000000', baseLocked: '2300000.00' },
      global,
    });
    await flushPromises();
    (w.vm as unknown as Vm).actualRate = '30000';
    await flushPromises();

    const note = w.find('[data-testid="slip-rate-effect"]');
    expect(note.exists()).toBe(true);
    // 100 USD locked at 23000 = 2,300,000; at 30000 it records 3,000,000 — an FX loss of 700,000.
    expect(note.text()).toMatch(/3,?000,?000/);
    expect(note.text()).toMatch(/700,?000/);
    // And it names the rate the document keeps, so nobody reads the unchanged header as a bug.
    expect(note.text()).toContain('23000.00');
  });

  it('says a matching rate changes nothing rather than computing a zero', async () => {
    list.mockResolvedValue([]);
    const w = mount(PaymentSlips, {
      props: { documentId: 'd1', lockedRate: '23000.00000000', baseLocked: '2300000.00' },
      global,
    });
    await flushPromises();
    expect(w.find('[data-testid="slip-rate-same"]').exists()).toBe(true);
    expect(w.find('[data-testid="slip-rate-effect"]').exists()).toBe(false);
  });

  it('says nothing about the effect when it cannot know the document’s amount', async () => {
    // No invented figures: a caller that passes no base amount gets no arithmetic.
    list.mockResolvedValue([]);
    const w = mount(PaymentSlips, { props: { documentId: 'd1', lockedRate: '23000' }, global });
    await flushPromises();
    (w.vm as unknown as Vm).actualRate = '30000';
    await flushPromises();
    expect(w.find('[data-testid="slip-rate-effect"]').exists()).toBe(false);
  });

  /**
   * A payment is written once. After that the account and the rate are settled, and a box that
   * accepts an edit and discards it is worse than no box.
   */
  it('stops asking once the payment is recorded, and says why', async () => {
    list.mockResolvedValue([{ ...SLIP, transferFrom: 'PRIMARY', actualRate: '30000.00000000' }]);
    const w = mount(PaymentSlips, { props: { documentId: 'd1', paymentRecorded: true }, global });
    await flushPromises();

    expect(w.find('[data-testid="slip-payment-recorded"]').exists()).toBe(true);
    expect(w.find('[data-testid="slip-transfer-from"]').exists()).toBe(false);
    expect(w.find('[data-testid="slip-actual-rate"]').exists()).toBe(false);
    // What WAS booked is still shown, beside the slip that stated it.
    expect(w.find('[data-testid="slip-stated-rate"]').text()).toContain('30000.00');
  });

  it('still accepts more evidence after the payment is recorded', async () => {
    // A second slip, a bank statement — welcome. It simply has nothing left to state.
    list.mockResolvedValue([SLIP]);
    const w = mount(PaymentSlips, { props: { documentId: 'd1', paymentRecorded: true }, global });
    await flushPromises();
    expect(w.find('[data-testid="slip-upload"]').exists()).toBe(true);

    upload.mockResolvedValue(SLIP);
    const f = new File(['x'], 'statement.pdf');
    await (w.vm as unknown as Vm).onUpload({ files: [f] });
    await flushPromises();
    expect(upload).toHaveBeenCalledWith('d1', f, {});
  });

  /**
   * A correction to a figure and a second copy of a slip already on file are different acts. Tying
   * them together is what silently discarded a rate finance had already typed — with nothing new to
   * attach, the value was never sent and the screen showed no error at all.
   */
  describe('correcting the rate on its own', () => {
    const restatable = { documentId: 'd1', canRestateRate: true, lockedRate: '30.00', baseLocked: '3000.00' };

    it('saves the rate without a file', async () => {
      list.mockResolvedValue([]);
      stateRate.mockResolvedValue({ documentId: 'd1', from: '30', to: '23', changed: true, baseTotalAmount: '2300', budgetReReserved: true });
      const w = mount(PaymentSlips, { props: restatable, global });
      await flushPromises();

      const vm = w.vm as unknown as Vm;
      vm.actualRate = '23';
      await vm.saveRate();
      await flushPromises();

      expect(stateRate).toHaveBeenCalledWith('d1', '23');
      expect(upload).not.toHaveBeenCalled();
    });

    it('shows an unsaved edit as unsaved', async () => {
      list.mockResolvedValue([]);
      const w = mount(PaymentSlips, { props: restatable, global });
      await flushPromises();
      // What it started at is stored, so nothing is pending.
      expect(w.find('[data-testid="slip-rate-unsaved"]').exists()).toBe(false);

      (w.vm as unknown as Vm).actualRate = '23';
      await flushPromises();
      expect(w.find('[data-testid="slip-rate-unsaved"]').exists()).toBe(true);
    });

    it('says what saving will do to the document and the budget', async () => {
      list.mockResolvedValue([]);
      const w = mount(PaymentSlips, { props: restatable, global });
      await flushPromises();
      (w.vm as unknown as Vm).actualRate = '23';
      await flushPromises();

      const note = w.find('[data-testid="slip-rate-effect-restates"]');
      expect(note.exists()).toBe(true);
      // 3000 at 30 becomes 2300 at 23 — stated before anything is saved.
      expect(note.text()).toMatch(/2,?300/);
    });

    it('offers no save at all where the server would refuse it', async () => {
      // A screen that offers an edit the server refuses teaches people that the screen lies.
      list.mockResolvedValue([{ ...SLIP, actualRate: '30.00000000' }]);
      const w = mount(PaymentSlips, { props: { documentId: 'd1', canRestateRate: false, lockedRate: '30.00' }, global });
      await flushPromises();

      expect(w.find('[data-testid="slip-rate-save"]').exists()).toBe(false);
      expect(w.find('[data-testid="slip-rate-locked"]').exists()).toBe(true);
      // And what was stated is still readable.
      expect(w.find('[data-testid="slip-stated-rate"]').text()).toContain('30.00');
    });
  });

  it('shows the rate each slip stated, beside the file', async () => {
    list.mockResolvedValue([{ ...SLIP, actualRate: '27.25000000' }]);
    const w = await mountPanel();
    expect(w.find('[data-testid="slip-stated-rate"]').text()).toContain('27.25');
    // The scale is display noise, not information — it must not come back on this line either.
    expect(w.find('[data-testid="slip-stated-rate"]').text()).not.toContain('27.25000000');
  });
});
