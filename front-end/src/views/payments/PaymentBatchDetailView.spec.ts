import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import ConfirmationService from 'primevue/confirmationservice';
import PrimeVue from 'primevue/config';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import PaymentBatchDetailView from './PaymentBatchDetailView.vue';
import type { PaymentBatchDetail } from '../../api/payments';

const get = vi.fn();
const importResult = vi.fn();
const importResultFile = vi.fn();
vi.mock('../../api/payments', () => ({
  paymentBatchesApi: {
    get: (...a: unknown[]) => get(...a),
    importResult: (...a: unknown[]) => importResult(...a),
    importResultFile: (...a: unknown[]) => importResultFile(...a),
    export: vi.fn(),
    cancel: vi.fn(),
  },
}));
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: () => true }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { id: 'b1' } }) }));
const error = vi.fn();
const success = vi.fn();
vi.mock('../../composables/useFeedback', () => ({ useFeedback: () => ({ error, success }) }));

const EXPORTED: PaymentBatchDetail = {
  batch: { id: 'b1', status: 'EXPORTED', format: 'CSV' },
  lines: [
    {
      id: 'l1',
      document: { id: 'd1', docNo: 'DISB-1' },
      bankCode: 'LDB',
      accountNo: '0209876543',
      accountName: 'Globex',
      amount: '40000.00',
      whtAmount: '0',
    },
  ],
} as unknown as PaymentBatchDetail;

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

async function mountView() {
  get.mockResolvedValue(EXPORTED);
  const w = mount(PaymentBatchDetailView, { global });
  await flushPromises();
  return w;
}

describe('PaymentBatchDetailView result file', () => {
  beforeEach(() => vi.clearAllMocks());

  // The whole point of the file: the bank's own answer decides which lines were paid, instead of
  // finance retyping fifty outcomes.
  it('sends the uploaded file with the rates already keyed per line', async () => {
    const w = await mountView();
    importResultFile.mockResolvedValue({ ...EXPORTED, batch: { ...EXPORTED.batch, status: 'COMPLETED' } });
    const file = new File(['docNo,result\nDISB-1,SUCCESS'], 'result.csv', { type: 'text/csv' });

    const vm = w.vm as unknown as { doImportFile: (e: { files: File[] }) => Promise<void> };
    await vm.doImportFile({ files: [file] });
    await flushPromises();

    expect(importResultFile).toHaveBeenCalledTimes(1);
    const [id, sent, rates] = importResultFile.mock.calls[0];
    expect(id).toBe('b1');
    expect(sent).toBe(file);
    // The locked rate prefilled into the grid travels as the rate we book the payment at.
    expect(rates).toEqual({ d1: '1' });
    expect(importResult).not.toHaveBeenCalled();
  });

  // The server aborts the whole import on an unparseable file; the user must be told what it
  // choked on, and the batch must be left alone.
  it('reports a file the parser refused and imports nothing', async () => {
    const w = await mountView();
    importResultFile.mockRejectedValue({
      response: { data: { message: 'row 3 names no document in this batch' } },
    });

    const vm = w.vm as unknown as {
      doImportFile: (e: { files: File[] }) => Promise<void>;
      detail: PaymentBatchDetail;
    };
    await vm.doImportFile({ files: [new File(['garbage'], 'x.pdf')] });
    await flushPromises();

    expect(error).toHaveBeenCalledWith('row 3 names no document in this batch');
    expect(success).not.toHaveBeenCalled();
    // The batch on screen is untouched — still EXPORTED, still one unanswered line.
    expect(vm.detail.batch.status).toBe('EXPORTED');
  });

  it('keeps the manual per-line import as the fallback', async () => {
    const w = await mountView();
    expect(w.find('[data-testid="import-btn"]').exists()).toBe(true);
    expect(w.find('[data-testid="import-file"]').exists()).toBe(true);
  });
});
