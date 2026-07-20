import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import ReadyToPayView from './ReadyToPayView.vue';
import type { PayableHandoff } from '../../api/payments';

const build = vi.fn();
vi.mock('../../api/payments', () => ({
  paymentBatchesApi: { build: (...a: unknown[]) => build(...a) },
}));
// WHT3 = 3%. The rate is a decimal STRING, like every money figure on the wire.
vi.mock('../../api/taxCodes', () => ({
  taxCodesApi: { selectableWht: () => Promise.resolve([{ id: 'w1', code: 'WHT3', name: 'WHT 3%', rate: '0.03' }]) },
}));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => true }) }));
const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const handoffs: PayableHandoff[] = [
  {
    documentId: 'd1',
    docNo: 'PR-1',
    vendorName: 'Globex',
    // A base amount whose 3% lands on a fraction — the case float arithmetic drifts on.
    baseAmount: '80250.10',
    glAccounts: ['5000'],
  } as PayableHandoff,
];
vi.mock('../../stores/payments', () => ({
  usePaymentsStore: () => ({
    handoffs,
    loading: false,
    error: '',
    loadHandoffs: vi.fn(),
    recordPayment: vi.fn(),
  }),
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

describe('ReadyToPayView money handling', () => {
  // Regression: the preview did `Number(baseAmount) * Number(rate)` and toFixed(2) — float
  // arithmetic on money (invariant: never a JS number), and 2 decimals regardless of the
  // currency. 80250.10 × 0.03 = 2407.503 exactly; the float path yields 2407.5029999999997.
  it('computes the WHT preview with Decimal, not float', async () => {
    const w = mount(ReadyToPayView, { global });
    await flushPromises();
    const vm = w.vm as unknown as {
      dialog: { open: boolean; doc?: PayableHandoff; whtTaxCodeId?: string; rate: string };
      whtPreview: { wht: string; net: string };
    };
    vm.dialog.doc = handoffs[0];
    vm.dialog.whtTaxCodeId = 'w1';
    await flushPromises();

    expect(vm.whtPreview.wht).toBe('2407.503');
    expect(vm.whtPreview.net).toBe('77842.597');
    // The float path's fingerprint must not reappear.
    expect(vm.whtPreview.wht).not.toContain('2407.5029999');
  });

  it('has no WHT to preview until a code is chosen', async () => {
    const w = mount(ReadyToPayView, { global });
    await flushPromises();
    const vm = w.vm as unknown as { dialog: { doc?: PayableHandoff }; whtPreview: { wht: string; net: string } };
    vm.dialog.doc = handoffs[0];
    await flushPromises();

    expect(vm.whtPreview.wht).toBe('0');
    expect(vm.whtPreview.net).toBe('80250.10');
  });
});
