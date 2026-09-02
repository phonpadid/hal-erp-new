import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { CreatableType } from '../../api/documents';
import DocumentTypePicker from './DocumentTypePicker.vue';

const global = { plugins: [createTestingPinia({ createSpy: vi.fn }), i18n, PrimeVue] };

const base = {
  requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
  requiresPayee: false, requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false,
};

const TYPES: CreatableType[] = [
  { ...base, id: 'memo', code: 'MEMO', name: 'Memo', category: 'ADMIN' },
  { ...base, id: 'plan', code: 'PLAN', name: 'Budget Plan', category: 'FINANCE', authoringRoute: 'budgets' },
];

/**
 * A card whose authoring screen this user cannot open is a door onto a wall — the navigation fires,
 * the router's guard redirects, and the user lands on the dashboard with nothing said and nothing
 * created. Shown disabled with the permission code instead, so the dead end becomes a request
 * somebody can act on.
 */
describe('DocumentTypePicker reachability', () => {
  const radios = (w: ReturnType<typeof mount>) => w.findAll('[role="radio"]');

  it('disables a card the user cannot reach and names the permission', () => {
    const w = mount(DocumentTypePicker, {
      props: { modelValue: '', types: TYPES, unreachable: { plan: 'BUDGET_VIEW' } },
      global,
    });
    const blocked = w.find('[data-testid="type-blocked"]');
    expect(blocked.exists()).toBe(true);
    // The code itself — what the system authorizes on, and what an administrator can act on.
    expect(blocked.text()).toContain('BUDGET_VIEW');
    expect(radios(w)[1].attributes('aria-disabled')).toBe('true');
  });

  it('refuses to select it by click', async () => {
    const w = mount(DocumentTypePicker, {
      props: { modelValue: '', types: TYPES, unreachable: { plan: 'BUDGET_VIEW' } },
      global,
    });
    await radios(w)[1].trigger('click');
    expect(w.emitted('update:modelValue')).toBeUndefined();
  });

  it('refuses to select it by keyboard, while still letting focus land on it', async () => {
    // Skipping it would hide the explanation from exactly the users who most need it announced.
    const w = mount(DocumentTypePicker, {
      props: { modelValue: 'memo', types: TYPES, unreachable: { plan: 'BUDGET_VIEW' } },
      global,
    });
    await radios(w)[0].trigger('keydown', { key: 'ArrowRight' });
    // Selection did not move onto the unreachable card...
    const emitted = w.emitted('update:modelValue') as string[][] | undefined;
    expect(emitted?.at(-1)?.[0]).not.toBe('plan');
    // ...but the card is still a real, focusable control carrying its reason.
    expect(radios(w)[1].attributes('aria-disabled')).toBe('true');
    expect(w.find('[data-testid="type-blocked"]').exists()).toBe(true);
  });

  it('leaves a reachable routed card selectable', async () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: '', types: TYPES }, global });
    await radios(w)[1].trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['plan']);
    expect(w.find('[data-testid="type-blocked"]').exists()).toBe(false);
  });

  it('leaves a type the wizard authors itself alone', async () => {
    // No authoring_route: no second screen, so no second permission to hold.
    const w = mount(DocumentTypePicker, {
      props: { modelValue: '', types: TYPES, unreachable: { plan: 'BUDGET_VIEW' } },
      global,
    });
    await radios(w)[0].trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['memo']);
  });
});
