import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import RecordPaymentDialog from './RecordPaymentDialog.vue';

vi.mock('../../api/payments', () => ({
  // The real list, not a stand-in: the method options the dialog offers come from the same
  // constant the server validates against, and a mocked set could drift from it silently.
  PAYMENT_METHODS: ['CASH', 'TRANSFER'] as const,
}));
// WHT3 = 3%. The rate is a decimal STRING, like every money figure on the wire.
vi.mock('../../api/taxCodes', () => ({
  taxCodesApi: { selectableWht: () => Promise.resolve([{ id: 'w1', code: 'WHT3', name: 'WHT 3%', rate: '0.03' }]) },
}));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => true }) }));
vi.mock('../../stores/payments', () => ({
  usePaymentsStore: () => ({ error: '', recordPayment: vi.fn() }),
}));

// LAK is the base currency and carries NO decimals — the old toFixed(2) printed kip wrong.
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
  directives: { tooltip: Tooltip },
};

// A base amount whose 3% lands on a fraction — the case float arithmetic drifts on.
const props = { visible: true, documentId: 'd1', docNo: 'PR-1', baseAmount: '80250.10' };

describe('RecordPaymentDialog money handling', () => {
  // Regression: the preview did `Number(baseAmount) * Number(rate)` and toFixed(2) — float
  // arithmetic on money (invariant: never a JS number), and 2 decimals regardless of the
  // currency. 80250.10 × 0.03 = 2407.503 exactly; the float path yields 2407.5029999999997.
  it('computes the WHT preview with Decimal, not float', async () => {
    const w = mount(RecordPaymentDialog, { props, global });
    await flushPromises();
    const vm = w.vm as unknown as {
      form: { whtTaxCodeId?: string };
      whtPreview: { wht: string; net: string };
    };
    vm.form.whtTaxCodeId = 'w1';
    await flushPromises();

    expect(vm.whtPreview.wht).toBe('2407.503');
    expect(vm.whtPreview.net).toBe('77842.597');
    // The float path's fingerprint must not reappear.
    expect(vm.whtPreview.wht).not.toContain('2407.5029999');
  });

  it('has no WHT to preview until a code is chosen', async () => {
    const w = mount(RecordPaymentDialog, { props, global });
    await flushPromises();
    const vm = w.vm as unknown as { whtPreview: { wht: string; net: string } };

    expect(vm.whtPreview.wht).toBe('0');
    expect(vm.whtPreview.net).toBe('80250.10');
  });

  // The mid-approval case: the record button must not force a fresh file when the caller already
  // knows a slip is attached — the server does not ask twice for the same money either.
  it('does not require a file when evidence is already attached', async () => {
    const w = mount(RecordPaymentDialog, { props: { ...props, evidenceAlreadyAttached: true }, global });
    await flushPromises();
    const vm = w.vm as unknown as { form: { rate: string }; canConfirm: boolean };
    vm.form.rate = '1.0';
    await flushPromises();

    expect(vm.canConfirm).toBe(true);
  });

  // The ready-to-pay queue case: nothing there came out of a bank batch, so a file is still
  // required, exactly as before this change.
  it('requires a file when evidence is not already attached', async () => {
    const w = mount(RecordPaymentDialog, { props, global });
    await flushPromises();
    const vm = w.vm as unknown as { form: { rate: string }; canConfirm: boolean };
    vm.form.rate = '1.0';
    await flushPromises();

    expect(vm.canConfirm).toBe(false);
  });
});
