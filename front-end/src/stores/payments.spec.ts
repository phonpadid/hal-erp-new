import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaymentsStore } from './payments';
import { paymentsApi } from '../api/payments';

vi.mock('../api/payments', () => ({
  paymentsApi: {
    handoffs: vi.fn(() => Promise.resolve([])),
    record: vi.fn(() => Promise.resolve({ documentId: 'd1', whtAmount: '3000.00', fxKind: 'NONE', fxDelta: '0', baseActual: '100000', baseLocked: '100000', lockedRate: '1', actualRate: '1' })),
  },
}));

describe('usePaymentsStore.recordPayment', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('forwards the WHT tax code to the API and returns the result', async () => {
    const store = usePaymentsStore();
    const file = new File(['slip'], 'slip.png');
    const result = await store.recordPayment('d1', { actualRate: '1', whtTaxCodeId: 'wht-3', file });
    expect(paymentsApi.record).toHaveBeenCalledWith('d1', {
      actualRate: '1',
      whtTaxCodeId: 'wht-3',
      file,
    });
    expect(result?.whtAmount).toBe('3000.00');
  });

  it('records without WHT when no code is passed', async () => {
    const store = usePaymentsStore();
    await store.recordPayment('d1', { actualRate: '1' });
    expect(paymentsApi.record).toHaveBeenCalledWith('d1', { actualRate: '1' });
  });

  // The evidence travels WITH the record — the store does not upload it separately, and there is
  // no window in which a payment exists without the file that justifies it.
  it('sends the evidence in the same call as the record', async () => {
    const store = usePaymentsStore();
    const file = new File(['slip'], 'slip.png');
    await store.recordPayment('d1', { actualRate: '1', method: 'CASH', file });
    expect(paymentsApi.record).toHaveBeenCalledWith('d1', {
      actualRate: '1',
      method: 'CASH',
      file,
    });
  });
});
