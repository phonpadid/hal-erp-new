import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import type { FormSubmitEvent } from '@primevue/forms';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import RecordSettlementDialog from './RecordSettlementDialog.vue';

const record = vi.fn();
vi.mock('../../stores/settlements', () => ({
  useSettlementsStore: () => ({ record: (...a: unknown[]) => record(...a), error: '' }),
}));
const can = vi.fn((_code: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c) }) }));
vi.mock('../../composables/useFeedback', () => ({ useFeedback: () => ({ error: vi.fn(), success: vi.fn() }) }));

const global = { plugins: [i18n, PrimeVue, ToastService, ConfirmationService] };

type Vm = {
  typeOptions: Array<{ label: string; value: string }>;
  file: File | null;
  fileError: boolean;
  onSubmit: (e: FormSubmitEvent) => Promise<void>;
};

// A valid form payload — settledAt built with local Y/M/D so the yyyy-mm-dd it formats to is
// timezone-independent.
const submitEvent = (): FormSubmitEvent =>
  ({
    valid: true,
    values: { settlementType: 'CASH', settledAt: new Date(2026, 7, 6), reference: 'TXN-9', note: '' },
  }) as unknown as FormSubmitEvent;

const mountDialog = () =>
  mount(RecordSettlementDialog, { props: { visible: true, documentId: 'd1', docNo: 'CLAIM-1' }, global });

describe('RecordSettlementDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockImplementation(() => true);
    record.mockResolvedValue(true);
  });

  it('offers CASH as the only settlement type', () => {
    const vm = mountDialog().vm as unknown as Vm;
    expect(vm.typeOptions).toHaveLength(1);
    expect(vm.typeOptions[0].value).toBe('CASH');
  });

  it('blocks submit and sends no request when no evidence is attached', async () => {
    const w = mountDialog();
    const vm = w.vm as unknown as Vm;
    await vm.onSubmit(submitEvent());
    expect(record).not.toHaveBeenCalled();
    expect(vm.fileError).toBe(true);
  });

  it('records a CASH settlement with the evidence and the yyyy-mm-dd date', async () => {
    const w = mountDialog();
    const vm = w.vm as unknown as Vm;
    const file = new File(['x'], 'slip.pdf', { type: 'application/pdf' });
    vm.file = file;
    await vm.onSubmit(submitEvent());
    expect(record).toHaveBeenCalledWith(
      'd1',
      { settlementType: 'CASH', settledAt: '2026-08-06', reference: 'TXN-9', note: undefined },
      file,
    );
    expect(w.emitted('recorded')).toBeTruthy();
    expect(w.emitted('update:visible')?.at(-1)).toEqual([false]);
  });
});
