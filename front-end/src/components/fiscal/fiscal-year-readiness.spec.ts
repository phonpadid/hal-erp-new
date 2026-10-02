import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { orgApi, type FiscalYearReadiness } from '../../api/org';
import type { CreatableType } from '../../api/documents';
import DocumentTypePicker from '../../views/documents/DocumentTypePicker.vue';
import FiscalYearReadinessBanner from './FiscalYearReadinessBanner.vue';
import FiscalYearReadinessPanel from './FiscalYearReadinessPanel.vue';

/**
 * The year turning unprepared, as the screens show it: budget types greyed out with the reason
 * before a form is filled, and the people who prepare a year told what is missing — on the
 * fiscal-years page and, inside the last thirty days, at the top of every page.
 */
beforeAll(() => { i18n.global.locale.value = 'en'; });
afterAll(() => { i18n.global.locale.value = 'la'; });
afterEach(() => {
  vi.restoreAllMocks();
  try { localStorage.clear(); } catch { /* storage unavailable */ }
});

const RouterLinkStub = { props: ['to'], template: '<a><slot /></a>' };
const globalWith = (permissions: string[]) => ({
  plugins: [
    createTestingPinia({ createSpy: vi.fn, initialState: { auth: { permissions, activeCompanyId: 'c1' } } }),
    i18n,
    PrimeVue,
  ],
  stubs: { RouterLink: RouterLinkStub },
});

const base = {
  requiresQuota: false, requiresVendor: false, requiresItem: false, requiresPayee: false,
  requiresWarehouse: false, requiresEmployee: false, accruesOnApproval: false,
};

describe('a budget type the year will not let start', () => {
  const TYPES: CreatableType[] = [
    { ...base, id: 'pr', code: 'PR', name: 'Purchase request', category: 'PROCUREMENT', requiresBudget: true, blocked: { key: 'fiscalYear.noOpenYear', year: 2027 } },
    { ...base, id: 'leave', code: 'LEAVE', name: 'Leave', category: 'HR', requiresBudget: false },
  ];
  const radios = (w: ReturnType<typeof mount>) => w.findAll('[role="radio"]');

  it('is disabled, says why on the card and once above the cards', () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: '', types: TYPES }, global: globalWith([]) });
    expect(radios(w)[0].attributes('aria-disabled')).toBe('true');
    expect(w.find('[data-testid="type-year-blocked"]').text()).toContain('2027');
    expect(w.find('[data-testid="year-blocked-notice"]').text()).toContain('Fiscal year 2027 has not been set up');
  });

  it('cannot be chosen, while a type that uses no budget still can', async () => {
    const w = mount(DocumentTypePicker, { props: { modelValue: '', types: TYPES }, global: globalWith([]) });
    await radios(w)[0].trigger('click');
    expect(w.emitted('update:modelValue')).toBeUndefined();
    await radios(w)[1].trigger('click');
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['leave']);
  });
});

const READINESS: FiscalYearReadiness = {
  today: '2026-12-05',
  current: { year: 2026, endDate: '2026-12-31', status: 'OPEN' },
  daysLeft: 26,
  target: { year: 2027, exists: false, status: null, activeBudgets: 0, missingEntitlements: 3, hasBudgetRate: false },
  ready: false,
  inWindow: true,
  blockedNow: null,
};

describe('the readiness panel', () => {
  it('lists each missing item for the next year', async () => {
    vi.spyOn(orgApi.fiscalYears, 'readiness').mockResolvedValue(READINESS);
    const w = mount(FiscalYearReadinessPanel, { global: globalWith(['FISCAL_YEAR_MANAGE']) });
    await flushPromises();
    expect(w.find('[data-testid="fy-readiness"]').text()).toContain('2027');
    expect(w.find('[data-testid="fy-readiness-fiscalYear"]').attributes('data-ok')).toBe('false');
    expect(w.find('[data-testid="fy-readiness-budgets"]').attributes('data-ok')).toBe('false');
    expect(w.find('[data-testid="fy-readiness-quota"]').text()).toContain('3 missing');
  });

  it('is not shown to someone who prepares nothing, and does not ask', async () => {
    const spy = vi.spyOn(orgApi.fiscalYears, 'readiness').mockResolvedValue(READINESS);
    const w = mount(FiscalYearReadinessPanel, { global: globalWith(['DOC_CREATE']) });
    await flushPromises();
    expect(w.find('[data-testid="fy-readiness"]').exists()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the banner', () => {
  it('shows inside the window while the next year is not ready', async () => {
    vi.spyOn(orgApi.fiscalYears, 'readiness').mockResolvedValue(READINESS);
    const w = mount(FiscalYearReadinessBanner, { global: globalWith(['BUDGET_MANAGE']) });
    await flushPromises();
    expect(w.find('[data-testid="fy-readiness-banner"]').text()).toContain('26 days');
  });

  it('is gone once the year is ready', async () => {
    vi.spyOn(orgApi.fiscalYears, 'readiness').mockResolvedValue({ ...READINESS, ready: true });
    const w = mount(FiscalYearReadinessBanner, { global: globalWith(['BUDGET_MANAGE']) });
    await flushPromises();
    expect(w.find('[data-testid="fy-readiness-banner"]').exists()).toBe(false);
  });

  it('says budget documents are blocked once the year turned unprepared', async () => {
    vi.spyOn(orgApi.fiscalYears, 'readiness').mockResolvedValue({
      ...READINESS, today: '2027-01-02', current: null, daysLeft: null, inWindow: false,
      blockedNow: { key: 'fiscalYear.noOpenYear', year: 2027 },
    });
    const w = mount(FiscalYearReadinessBanner, { global: globalWith(['QUOTA_MANAGE']) });
    await flushPromises();
    expect(w.find('[data-testid="fy-readiness-banner"]').text()).toContain('cannot be created now');
  });

  it('stays hidden for the rest of the day once dismissed', async () => {
    vi.spyOn(orgApi.fiscalYears, 'readiness').mockResolvedValue(READINESS);
    const w = mount(FiscalYearReadinessBanner, { global: globalWith(['BUDGET_MANAGE']) });
    await flushPromises();
    await w.find('[data-testid="fy-readiness-dismiss"]').trigger('click');
    expect(w.find('[data-testid="fy-readiness-banner"]').exists()).toBe(false);

    const again = mount(FiscalYearReadinessBanner, { global: globalWith(['BUDGET_MANAGE']) });
    await flushPromises();
    expect(again.find('[data-testid="fy-readiness-banner"]').exists()).toBe(false);
  });
});
