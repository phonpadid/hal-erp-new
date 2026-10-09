import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import ReadyToPayView from './ReadyToPayView.vue';
import type { PayableHandoff } from '../../api/payments';

const build = vi.fn();
vi.mock('../../api/payments', () => ({
  paymentBatchesApi: { build: (...a: unknown[]) => build(...a) },
  // The real list, not a stand-in: the method options the dialog offers come from the same
  // constant the server validates against, and a mocked set could drift from it silently.
  PAYMENT_METHODS: ['CASH', 'TRANSFER'] as const,
  TRANSFER_SOURCES: ['PRIMARY', 'RESERVE'] as const,
  // The confirmation panel mounts PaymentSlips, which reads this the moment it appears.
  paymentsApi: { slips: { list: () => Promise.resolve([]) } },
}));
// WHT3 = 3%. The rate is a decimal STRING, like every money figure on the wire.
vi.mock('../../api/taxCodes', () => ({
  taxCodesApi: { selectableWht: () => Promise.resolve([{ id: 'w1', code: 'WHT3', name: 'WHT 3%', rate: '0.03' }]) },
}));
// The base currency belongs on this mock, not only in the pinia state: the view asks the auth
// store for it, and a screen that cannot tell which money is the company's own cannot tell which
// documents have no rate to state.
vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ can: () => true, baseCurrency: { code: 'LAK', decimalPlaces: 0 } }),
}));
const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

const handoffs: PayableHandoff[] = [
  {
    documentId: 'd1',
    docNo: 'PR-1',
    payableKind: 'TRADE',
    owedTo: 'Globex',
    vendorName: 'Globex',
    // A base amount whose 3% lands on a fraction — the case float arithmetic drifts on.
    baseAmount: '80250.10',
    // A foreign-currency document, which is what a locked rate of 26.5 means: a base-currency one
    // is fixed at 1 and offers nothing to type (see the describe at the end of this file).
    currency: 'THB',
    // Stamped at submit; the record form starts the actual rate here.
    lockedRate: '26.50000000',
    glAccounts: ['5000'],
  } as PayableHandoff,
];
const recordSpy = vi.fn(() =>
  Promise.resolve({
    documentId: 'd1', lockedRate: '26.5', actualRate: '27',
    baseLocked: '80250.10', baseActual: '80250.10', fxDelta: '0', fxKind: 'NONE', whtAmount: '0',
    transferFrom: 'RESERVE',
  }),
);
vi.mock('../../stores/payments', () => ({
  usePaymentsStore: () => ({
    handoffs,
    loading: false,
    error: '',
    loadHandoffs: vi.fn(),
    recordPayment: (...a: unknown[]) => recordSpy(...(a as [])),
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

/**
 * Which of the company's OWN accounts a transfer left. Asked of a transfer only — cash left no
 * bank account — and required before the form will submit one, so the screen refuses what the
 * server would refuse instead of spending a round-trip discovering it.
 */
describe('ReadyToPayView: which account paid', () => {
  type Vm = {
    dialog: {
      open: boolean;
      doc?: PayableHandoff;
      rate: string;
      method: string;
      transferFrom?: string;
      file?: File;
      result?: unknown;
    };
    canConfirm: boolean;
    openRecord: (doc: PayableHandoff) => void;
    onMethodChange: (m: string) => void;
    confirmRecord: () => Promise<void>;
  };

  // PrimeVue teleports a Dialog's body to <body>, so the wrapper cannot see inside it. Query the
  // document, and unmount between cases so a previous dialog's nodes are not what gets found.
  let mounted: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });
  const inDialog = (testId: string) => document.body.querySelector(`[data-testid="${testId}"]`);

  const openDialog = async () => {
    const w = mount(ReadyToPayView, { global, attachTo: document.body });
    mounted = w;
    await flushPromises();
    const vm = w.vm as unknown as Vm;
    vm.openRecord(handoffs[0]);
    await flushPromises();
    return { w, vm };
  };

  it('asks which account a transfer left, and stops asking for cash', async () => {
    const { vm } = await openDialog();
    expect(inDialog('transfer-from')).not.toBeNull();

    vm.onMethodChange('CASH');
    await flushPromises();
    expect(inDialog('transfer-from')).toBeNull();
    // Cleared, not merely hidden: a choice made before switching to cash must not be submitted by
    // a form that no longer shows it.
    expect(vm.dialog.transferFrom).toBeUndefined();
  });

  it('will not submit a transfer until an account is chosen', async () => {
    const { vm } = await openDialog();
    vm.dialog.file = new File(['x'], 'slip.png', { type: 'image/png' });
    await flushPromises();
    expect(vm.canConfirm).toBe(false);

    vm.dialog.transferFrom = 'RESERVE';
    await flushPromises();
    expect(vm.canConfirm).toBe(true);
  });

  it('lets cash be confirmed without one', async () => {
    const { vm } = await openDialog();
    vm.onMethodChange('CASH');
    vm.dialog.file = new File(['x'], 'slip.png', { type: 'image/png' });
    await flushPromises();
    expect(vm.canConfirm).toBe(true);
  });

  it('pre-fills the actual rate from the document, and sends what was typed over it', async () => {
    const { vm } = await openDialog();
    // Offered, not demanded: finance is confirming a figure the document already carries — and
    // offered trimmed of the scale NUMERIC(18,8) reads back with, which is eight zeros to look past.
    expect(vm.dialog.rate).toBe('26.50');

    vm.dialog.rate = '27.25';
    vm.dialog.transferFrom = 'RESERVE';
    vm.dialog.file = new File(['x'], 'slip.png', { type: 'image/png' });
    await vm.confirmRecord();

    expect(recordSpy).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ actualRate: '27.25', transferFrom: 'RESERVE' }),
    );
  });

  it('reads the recorded choice back from the result', async () => {
    const { vm } = await openDialog();
    vm.dialog.rate = '27.25';
    vm.dialog.transferFrom = 'RESERVE';
    vm.dialog.file = new File(['x'], 'slip.png', { type: 'image/png' });
    await vm.confirmRecord();
    await flushPromises();

    // Against the catalog, not a hardcoded English string: the app's default locale is Lao.
    expect(inDialog('recorded-transfer-from')?.textContent).toContain(
      i18n.global.t('payments.record.transferFrom.RESERVE'),
    );
  });
});

/**
 * A document paid in the money the books are kept in has no exchange rate to state: it is 1, and
 * the server refuses anything else. The field that accepted 695 for a kip document is the one this
 * describe closes.
 */
describe('ReadyToPayView: a base-currency document has no rate to type', () => {
  type Vm = {
    dialog: { open: boolean; doc?: PayableHandoff; rate: string };
    rateIsFixed: boolean;
    openRecord: (doc: PayableHandoff) => void;
  };
  let mounted: ReturnType<typeof mount> | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  const open = async (doc: PayableHandoff) => {
    const w = mount(ReadyToPayView, { global, attachTo: document.body });
    mounted = w;
    await flushPromises();
    const vm = w.vm as unknown as Vm;
    vm.openRecord(doc);
    await flushPromises();
    return vm;
  };

  const kipDoc = { ...handoffs[0], documentId: 'd-lak', docNo: 'REC-1', currency: 'LAK', lockedRate: '1' };
  const noCurrencyDoc = { ...handoffs[0], documentId: 'd-null', docNo: 'REC-2', currency: undefined, lockedRate: '1' };

  it('fixes the rate at 1 and disables the field for a base-currency document', async () => {
    const vm = await open(kipDoc as PayableHandoff);

    expect(vm.rateIsFixed).toBe(true);
    expect(vm.dialog.rate).toBe('1');
    expect(document.body.querySelector('[data-testid="rate-fixed"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="actual-rate"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('treats a document with no currency as the base currency', async () => {
    const vm = await open(noCurrencyDoc as PayableHandoff);
    expect(vm.rateIsFixed).toBe(true);
    expect(vm.dialog.rate).toBe('1');
  });

  it('ignores whatever a slip stated for a base-currency document', async () => {
    const vm = await open({ ...kipDoc, statedActualRate: '695' } as PayableHandoff);
    expect(vm.dialog.rate).toBe('1');
  });

  it('still asks for the rate on a foreign-currency document', async () => {
    const vm = await open(handoffs[0]);

    expect(vm.rateIsFixed).toBe(false);
    expect(vm.dialog.rate).toBe('26.50');
    expect(document.body.querySelector('[data-testid="rate-fixed"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="actual-rate"]')?.hasAttribute('disabled')).toBe(false);
  });
});
