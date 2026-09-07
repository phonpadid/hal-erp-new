import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import Checkbox from 'primevue/checkbox';
import Select from 'primevue/select';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { lineVat } from '../../utils/form';
import LineItemsEditor, { type EditorLine } from './LineItemsEditor.vue';

const global = { plugins: [createTestingPinia({ createSpy: vi.fn }), i18n, PrimeVue] };

// The Lao standard rate, as `tax_code` carries it: a decimal fraction string, never a JS number.
const VAT10 = [{ id: 'tc1', code: 'VAT10', name: 'VAT 10%', rate: '0.100000' }];
const TWO_RATES = [...VAT10, { id: 'tc2', code: 'VAT0', name: 'Zero-rated', rate: '0.000000' }];

const mountEditor = (lines: EditorLine[], vatCodes = VAT10) =>
  mount(LineItemsEditor, {
    props: {
      modelValue: lines, currency: 'THB', items: [], budgets: [],
      canMaster: false, canBudget: false, vatCodes,
    },
    global,
  });

describe('per-line VAT', () => {
  it('offers a tick box, not a picker, when one VAT rate is configured', () => {
    const w = mountEditor([{ description: 'x', qty: '1', unitPrice: '100' }]);
    expect(w.findComponent(Checkbox).exists()).toBe(true);
    expect(w.findComponent(Select).exists()).toBe(false);
  });

  // The rate is read off the tax_code row, not written in the component (invariant 7): a company
  // that files at 7% must see 7%, and nothing here knows the number until the row arrives.
  it('labels the box with the configured rate', () => {
    expect(mountEditor([{ description: 'x', qty: '1', unitPrice: '100' }]).text()).toContain('10%');
    const seven = mountEditor(
      [{ description: 'x', qty: '1', unitPrice: '100' }],
      [{ id: 'tc7', code: 'VAT7', name: 'VAT 7%', rate: '0.070000' }],
    );
    expect(seven.text()).toContain('7%');
    expect(seven.text()).not.toContain('10%');
  });

  it('leaves a line untaxed until the box is ticked, and carries no tax code when it is not', async () => {
    const lines: EditorLine[] = [{ description: 'x', qty: '1', unitPrice: '100' }];
    const w = mountEditor(lines);
    expect(lines[0].taxCodeId).toBeUndefined();

    await w.findComponent(Checkbox).vm.$emit('update:modelValue', true);
    expect(lines[0].taxCodeId).toBe('tc1');

    // Unticking must clear the code outright — an empty string would still be a tax code to the
    // server, and the document would claim VAT the requester just said it does not carry.
    await w.findComponent(Checkbox).vm.$emit('update:modelValue', false);
    expect(lines[0].taxCodeId).toBeUndefined();
  });

  it('shows the VAT and the with-VAT total once a line is taxed', () => {
    const w = mountEditor([{ description: 'x', qty: '2', unitPrice: '50', taxCodeId: 'tc1' }]);
    expect(w.text()).toContain('100.00'); // net: 2 × 50
    expect(w.text()).toContain('10.00'); // VAT at 10%
    expect(w.text()).toContain('110.00'); // incl. VAT
  });

  it('keeps the picker when several VAT rates are configured — a box cannot say which', () => {
    const w = mountEditor([{ description: 'x', qty: '1', unitPrice: '100' }], TWO_RATES);
    expect(w.findComponent(Select).exists()).toBe(true);
    expect(w.findComponent(Checkbox).exists()).toBe(false);
  });

  it('hides the VAT affordance entirely when no VAT code is configured', () => {
    const w = mountEditor([{ description: 'x', qty: '1', unitPrice: '100' }], []);
    expect(w.findComponent(Checkbox).exists()).toBe(false);
    expect(w.findComponent(Select).exists()).toBe(false);
  });
});

describe('lineVat', () => {
  // Mirrors TaxService.computeLineVat: round(net × rate) at the currency's places, HALF_UP.
  it('rounds to the currency places the way the server does', () => {
    expect(lineVat('100', '0.10', 2)).toBe('10.00');
    expect(lineVat('33.33', '0.10', 2)).toBe('3.33');
    expect(lineVat('1.05', '0.10', 2)).toBe('0.11'); // 0.105 → HALF_UP
    expect(lineVat('1000', '0.10', 0)).toBe('100'); // a 0-dp currency (LAK/JPY)
  });

  it('is zero for a line with no rate — VAT is opt-in', () => {
    expect(lineVat('100', undefined, 2)).toBe('0');
  });
});
