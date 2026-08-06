import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import SettlementPanel from './SettlementPanel.vue';

const read = vi.fn();
const record = vi.fn();
vi.mock('../../api/settlements', () => ({
  settlementsApi: {
    read: (...a: unknown[]) => read(...a),
    record: (...a: unknown[]) => record(...a),
  },
  SETTLEMENT_TYPES: ['CASH'],
}));
const can = vi.fn((_code: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c) }) }));
vi.mock('../../stores/settlements', () => ({
  useSettlementsStore: () => ({ record: vi.fn(), error: '' }),
}));
vi.mock('../../composables/useFeedback', () => ({ useFeedback: () => ({ error: vi.fn(), success: vi.fn() }) }));

const global = { plugins: [i18n, PrimeVue, ToastService, ConfirmationService] };

const mountPanel = async () => {
  const w = mount(SettlementPanel, { props: { documentId: 'd1', docNo: 'CLAIM-1' }, global });
  await flushPromises();
  return w;
};

describe('SettlementPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockImplementation(() => true);
  });

  it('shows how a settled document was settled', async () => {
    read.mockResolvedValue({ settlementType: 'CASH', settledAt: '2026-08-06', reference: 'TXN-1' });
    const w = await mountPanel();
    expect(read).toHaveBeenCalledWith('d1');
    const recorded = w.find('[data-testid="settlement-recorded"]');
    expect(recorded.exists()).toBe(true);
    expect(recorded.text()).toContain('TXN-1');
    expect(w.find('[data-testid="settlement-awaiting"]').exists()).toBe(false);
  });

  // A 404 read is the normal "approved, awaiting settlement" state — not an error.
  it('renders a 404 read as approved, awaiting settlement', async () => {
    read.mockResolvedValue(null);
    const w = await mountPanel();
    expect(w.find('[data-testid="settlement-awaiting"]').exists()).toBe(true);
    expect(w.find('[data-testid="settlement-recorded"]').exists()).toBe(false);
  });

  it('offers the record action to a PAYMENT_MANAGE user on an unsettled document', async () => {
    read.mockResolvedValue(null);
    const w = await mountPanel();
    expect(w.find('[data-testid="panel-record"]').exists()).toBe(true);
  });

  // The client guard is UX only, but it must mirror the server's code.
  it('hides the record action without PAYMENT_MANAGE', async () => {
    can.mockImplementation((c: string) => c !== 'PAYMENT_MANAGE');
    read.mockResolvedValue(null);
    const w = await mountPanel();
    expect(w.find('[data-testid="settlement-awaiting"]').exists()).toBe(true);
    expect(w.find('[data-testid="panel-record"]').exists()).toBe(false);
  });
});
