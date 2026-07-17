import { flushPromises, mount } from '@vue/test-utils';
import ConfirmationService from 'primevue/confirmationservice';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import PaymentSlips from './PaymentSlips.vue';

const list = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
vi.mock('../../api/payments', () => ({
  paymentsApi: {
    slips: {
      list: (...a: unknown[]) => list(...a),
      upload: (...a: unknown[]) => upload(...a),
      remove: (...a: unknown[]) => remove(...a),
      downloadUrl: vi.fn(),
    },
  },
}));
const can = vi.fn((_code: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c) }) }));
vi.mock('../../composables/useFeedback', () => ({
  useFeedback: () => ({ error: vi.fn(), success: vi.fn() }),
}));

const global = { plugins: [i18n, PrimeVue, ToastService, ConfirmationService] };
const SLIP = { id: 's1', fileName: 'slip.png', fileSizeKb: 12 };

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

  // A document with no payment has nothing to be evidence of — the parent hides the whole card.
  it('tells the parent when the document has no payment at all', async () => {
    list.mockRejectedValue({ response: { status: 404 } });
    const w = await mountPanel();
    expect(w.emitted('absent')).toBeTruthy();
  });

  it('uploads against the document it was opened from and reloads', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    upload.mockResolvedValue(SLIP);
    list.mockResolvedValue([SLIP]);

    const file = new File(['x'], 'slip.png', { type: 'image/png' });
    const vm = w.vm as unknown as { onUpload: (e: { files: File[] }) => Promise<void> };
    await vm.onUpload({ files: [file] });
    await flushPromises();

    expect(upload).toHaveBeenCalledWith('d1', file);
    expect(list).toHaveBeenCalledTimes(2); // reloaded after the upload
  });

  it('attaches every file of a multi-file pick', async () => {
    list.mockResolvedValue([]);
    const w = await mountPanel();
    upload.mockResolvedValue(SLIP);
    const a = new File(['a'], 'a.png');
    const b = new File(['b'], 'b.pdf');

    const vm = w.vm as unknown as { onUpload: (e: { files: File[] }) => Promise<void> };
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
});
