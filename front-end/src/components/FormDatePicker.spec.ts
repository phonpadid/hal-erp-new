import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it } from 'vitest';
import FormDatePicker from './FormDatePicker.vue';

import { i18n } from '../i18n';

const global = { plugins: [PrimeVue, i18n] };

/**
 * Typing into this field used to be discarded in silence: the control accepts keystrokes, shows
 * them, and drops anything it cannot parse. A promotion lost its effective date exactly that way —
 * the review step showed a dash and nothing at any stage said the date had gone.
 */
describe('FormDatePicker', () => {
  const input = (w: ReturnType<typeof mount>) => w.find('input');

  it('round-trips an ISO value through the calendar format it displays', () => {
    const w = mount(FormDatePicker, { props: { modelValue: '2026-08-29' }, global });
    expect(input(w).element.value).toBe('2026-08-29');
  });

  it('says the entry was not accepted — PrimeVue clears the box, so the message is the signal', async () => {
    const w = mount(FormDatePicker, { props: { modelValue: '' }, global });
    await input(w).setValue('not a date');
    expect(w.findComponent({ name: 'DatePicker' }).props('invalid')).toBe(true);
    expect(w.find('[data-testid="date-invalid"]').exists()).toBe(true);
  });

  it('accepts a date typed in the format the field shows', async () => {
    const w = mount(FormDatePicker, { props: { modelValue: '' }, global });
    await input(w).setValue('2026-09-01');
    expect(w.findComponent({ name: 'DatePicker' }).props('invalid')).toBe(false);
  });

  it('treats an emptied field as empty, not as invalid', async () => {
    const w = mount(FormDatePicker, { props: { modelValue: '2026-08-29' }, global });
    await input(w).setValue('');
    expect(w.findComponent({ name: 'DatePicker' }).props('invalid')).toBe(false);
  });
});
