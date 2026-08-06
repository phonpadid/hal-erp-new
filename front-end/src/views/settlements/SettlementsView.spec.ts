import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import SettlementsView from './SettlementsView.vue';
import type { UnsettledDocument } from '../../api/settlements';

let unsettled: UnsettledDocument[] = [];
const loadUnsettled = vi.fn();
vi.mock('../../stores/settlements', () => ({
  useSettlementsStore: () => ({ unsettled, loading: false, error: '', loadUnsettled, record: vi.fn() }),
}));
const can = vi.fn((_code: string) => true);
vi.mock('../../stores/auth', () => ({ useAuthStore: () => ({ can: (c: string) => can(c) }) }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const global = {
  plugins: [
    createTestingPinia({ createSpy: vi.fn, initialState: { currency: { currencies: [{ code: 'LAK', decimalPlaces: 0 }] } } }),
    i18n,
    PrimeVue,
    ToastService,
    ConfirmationService,
  ],
};

const ROW: UnsettledDocument = { id: 'd1', docNo: 'CLAIM-HAL-1', department: 'Claims', totalAmount: '100000', approvedAt: '2026-08-06' };

const mountView = async () => {
  const w = mount(SettlementsView, { global });
  await flushPromises();
  return w;
};

describe('SettlementsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    can.mockImplementation(() => true);
    unsettled = [];
  });

  it('lists the unsettled queue', async () => {
    unsettled = [ROW];
    const w = await mountView();
    expect(loadUnsettled).toHaveBeenCalled();
    expect(w.text()).toContain('CLAIM-HAL-1');
    expect(w.text()).toContain('Claims');
  });

  it('says so when nothing is awaiting settlement', async () => {
    unsettled = [];
    const w = await mountView();
    expect(w.text()).toContain(i18n.global.t('settlements.empty'));
    expect(w.find('[data-testid="open-record"]').exists()).toBe(false);
  });

  it('offers the record action to a PAYMENT_MANAGE user', async () => {
    unsettled = [ROW];
    const w = await mountView();
    expect(w.find('[data-testid="open-record"]').exists()).toBe(true);
  });

  // The client guard is UX only, but it must mirror the server's code.
  it('hides the record action without PAYMENT_MANAGE', async () => {
    can.mockImplementation((c: string) => c !== 'PAYMENT_MANAGE');
    unsettled = [ROW];
    const w = await mountView();
    expect(w.find('[data-testid="open-record"]').exists()).toBe(false);
  });
});
