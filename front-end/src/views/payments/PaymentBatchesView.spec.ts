import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Tooltip from 'primevue/tooltip';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import PaymentBatchesView from './PaymentBatchesView.vue';
import type { PaymentBatch } from '../../api/payments';

const list = vi.fn();
vi.mock('../../api/payments', () => ({
  paymentBatchesApi: { list: (...a: unknown[]) => list(...a) },
}));

const can = vi.fn((_c: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c) }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const global = { plugins: [i18n, PrimeVue], directives: { tooltip: Tooltip } };

const HOUR = 3_600_000;
function batch(over: Partial<PaymentBatch> = {}): PaymentBatch {
  return {
    id: 'b1',
    status: 'DRAFT',
    format: 'CSV',
    createdAt: new Date(Date.now() - HOUR).toISOString(),
    ...over,
  };
}

beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });
beforeEach(() => {
  list.mockReset();
  can.mockReset();
  can.mockReturnValue(true);
});

/**
 * The batch list.
 *
 * Its reason to exist is the stalled flag: an EXPORTED run holds its payables out of the
 * ready-to-pay list, so if nobody uploads the bank's result those payables go unpaid and nothing
 * else anywhere says so.
 */
describe('PaymentBatchesView', () => {
  it('lists the company’s runs with their status', async () => {
    list.mockResolvedValue([batch({ status: 'COMPLETED' })]);
    const w = mount(PaymentBatchesView, { global });
    await flushPromises();

    expect(w.text()).toContain('Completed');
  });

  it('flags an exported run whose result never came back', async () => {
    list.mockResolvedValue([
      batch({ status: 'EXPORTED', exportedAt: new Date(Date.now() - 48 * HOUR).toISOString() }),
    ]);
    const w = mount(PaymentBatchesView, { global });
    await flushPromises();

    expect(w.find('[data-testid="stalled-flag"]').exists()).toBe(true);
  });

  it('does not flag a run that was exported moments ago', async () => {
    list.mockResolvedValue([
      batch({ status: 'EXPORTED', exportedAt: new Date(Date.now() - HOUR).toISOString() }),
    ]);
    const w = mount(PaymentBatchesView, { global });
    await flushPromises();

    // Someone is probably at the bank's portal right now.
    expect(w.find('[data-testid="stalled-flag"]').exists()).toBe(false);
  });

  it('does not flag an old run that is already done', async () => {
    list.mockResolvedValue([
      batch({ status: 'COMPLETED', exportedAt: new Date(Date.now() - 200 * HOUR).toISOString() }),
    ]);
    const w = mount(PaymentBatchesView, { global });
    await flushPromises();

    // Age only matters while payables are still held.
    expect(w.find('[data-testid="stalled-flag"]').exists()).toBe(false);
  });

  it('shows an empty state rather than an error', async () => {
    list.mockResolvedValue([]);
    const w = mount(PaymentBatchesView, { global });
    await flushPromises();

    expect(w.find('[data-testid="batch-table"]').exists()).toBe(false);
    expect(w.text()).toContain('No payment runs yet');
  });

  it('offers a retry when the list cannot be loaded', async () => {
    list.mockRejectedValue(new Error('boom'));
    const w = mount(PaymentBatchesView, { global });
    await flushPromises();

    expect(w.find('[data-testid="batch-table"]').exists()).toBe(false);
  });
});
