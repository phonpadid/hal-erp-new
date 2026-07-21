import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import InputNumber from 'primevue/inputnumber';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { SelectableQuota } from '../../api/quotas';
import QuotaReservationsEditor, { type ReservationRow } from './QuotaReservationsEditor.vue';

const global = {
  plugins: [createTestingPinia({ createSpy: vi.fn }), i18n, PrimeVue],
};

const QUOTAS: SelectableQuota[] = [
  { id: 'q-pool', quotaType: 'ASSET_BOOKING', unit: 'ครั้ง', resetCycle: 'YEARLY', personal: false, remaining: '5' },
  { id: 'q-personal', quotaType: 'ANNUAL_LEAVE', unit: 'day', resetCycle: 'YEARLY', personal: true, remaining: '8' },
];

const mountEditor = (rows: ReservationRow[], attempted = false) =>
  mount(QuotaReservationsEditor, { props: { modelValue: rows, quotas: QUOTAS, attempted }, global });

describe('QuotaReservationsEditor', () => {
  it('shows the empty state with an add-first-reservation affordance', () => {
    const w = mountEditor([]);
    expect(w.text()).toContain('ຍັງບໍ່ມີການຈອງໂຄຕາ'); // la: "No quota reservations yet."
    expect(w.findComponent({ name: 'Button' }).exists()).toBe(true);
  });

  it('adds the first reservation from the empty state', async () => {
    const rows: ReservationRow[] = [];
    const w = mountEditor(rows);
    await w.findComponent({ name: 'Button' }).trigger('click');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ quotaId: '', qty: '1' });
  });

  it('keeps qty a string when InputNumber emits a number', async () => {
    const rows: ReservationRow[] = [{ quotaId: 'q-pool', qty: '1' }];
    const w = mountEditor(rows);
    await w.findComponent(InputNumber).vm.$emit('update:modelValue', 3);
    expect(rows[0].qty).toBe('3');
    expect(typeof rows[0].qty).toBe('string');
  });

  it('shows advisory remaining and a self-beneficiary note for a personal quota', () => {
    const w = mountEditor([{ quotaId: 'q-personal', qty: '2' }]);
    expect(w.text()).toContain('8 day'); // advisory remaining + unit
    expect(w.text()).toContain('ນຳໃຊ້ກັບທ່ານ'); // la: "Applies to you"
  });

  it('shows no self-beneficiary note for a pool quota', () => {
    const w = mountEditor([{ quotaId: 'q-pool', qty: '2' }]);
    expect(w.text()).not.toContain('ນຳໃຊ້ກັບທ່ານ');
  });

  it('flags an invalid reservation only after the step is attempted', async () => {
    const invalid: ReservationRow[] = [{ quotaId: '', qty: '0' }];
    const clean = mountEditor(invalid, false);
    expect(clean.text()).not.toContain('ເລືອກໂຄຕາ ແລະ ຈຳນວນ'); // no error before attempt
    const attempted = mountEditor(invalid, true);
    expect(attempted.text()).toContain('ເລືອກໂຄຕາ ແລະ ຈຳນວນ'); // la invalid message
  });

  it('renders no employee/beneficiary picker (server resolves self)', () => {
    const w = mountEditor([{ quotaId: 'q-personal', qty: '2' }]);
    // Exactly two selects would exist if there were a beneficiary picker; the editor has one
    // (the quota) per row. Assert only the quota select is present.
    expect(w.findAllComponents({ name: 'Select' })).toHaveLength(1);
  });
});
