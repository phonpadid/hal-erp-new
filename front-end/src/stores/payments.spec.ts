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
    const result = await store.recordPayment('d1', '1', 'wht-3');
    expect(paymentsApi.record).toHaveBeenCalledWith('d1', '1', 'wht-3');
    expect(result?.whtAmount).toBe('3000.00');
  });

  it('records without WHT when no code is passed', async () => {
    const store = usePaymentsStore();
    await store.recordPayment('d1', '1');
    expect(paymentsApi.record).toHaveBeenCalledWith('d1', '1', undefined);
  });
});
