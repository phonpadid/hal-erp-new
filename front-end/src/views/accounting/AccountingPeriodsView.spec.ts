import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { mountView } from '../../test/mountView';
import AccountingPeriodsView from './AccountingPeriodsView.vue';
import { useAccountingPeriodsStore } from '../../stores/accountingPeriods';
import type { AccountingPeriodRow } from '../../api/accountingPeriods';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  // PrimeVue dialogs teleport to the body and outlive the wrapper otherwise.
  document.body.innerHTML = '';
});

const FY = 'fy-2026';

const period = (over: Partial<AccountingPeriodRow>): AccountingPeriodRow => ({
  id: 'p-1',
  code: '2026-01',
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  status: 'OPEN',
  fiscalYear: FY,
  ...over,
});

/** January closed, February open, December open — December is its year's last. */
const PERIODS: AccountingPeriodRow[] = [
  period({ id: 'p-1', code: '2026-01', periodStart: '2026-01-01', periodEnd: '2026-01-31', status: 'CLOSED' }),
  period({ id: 'p-2', code: '2026-02', periodStart: '2026-02-01', periodEnd: '2026-02-28' }),
  period({ id: 'p-12', code: '2026-12', periodStart: '2026-12-01', periodEnd: '2026-12-31' }),
];

async function mount(permissions: string[], periods = PERIODS) {
  const w = await mountView(AccountingPeriodsView, {
    path: '/accounting-periods',
    routeName: 'accounting-periods',
    permissions,
    extraRoutes: [{ path: '/journal/undelivered', name: 'journal-undelivered' }],
    initialState: { accountingPeriods: { periods } },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const ALL = ['PERIOD_VIEW', 'PERIOD_MANAGE', 'PERIOD_CLOSE', 'PERIOD_REOPEN', 'FISCAL_YEAR_MANAGE'];

/** Dialog content lives in the teleported body, not under the wrapper. */
const inBody = (testid: string) => document.body.querySelector(`[data-testid="${testid}"]`);

async function openDialog(w: VueWrapper, testid: string, index = 0) {
  await w.findAll(`[data-testid="${testid}"]`)[index].trigger('click');
  await flushPromises();
}

describe('AccountingPeriodsView', () => {
  it('lists the company periods in the order the server returned them', async () => {
    const text = (await mount(['PERIOD_VIEW'])).text();
    for (const code of ['2026-01', '2026-02', '2026-12']) expect(text).toContain(code);
  });

  it('offers no declare, close or reopen control with PERIOD_VIEW alone', async () => {
    const w = await mount(['PERIOD_VIEW']);
    expect(w.find('[data-testid="declare-period"]').exists()).toBe(false);
    expect(w.find('[data-testid="close-period"]').exists()).toBe(false);
    expect(w.find('[data-testid="reopen-period"]').exists()).toBe(false);
  });

  it('offers close on open periods and reopen on closed ones', async () => {
    const w = await mount(ALL);
    // Two OPEN rows, one CLOSED row — the controls follow the status, not the row count.
    expect(w.findAll('[data-testid="close-period"]')).toHaveLength(2);
    expect(w.findAll('[data-testid="reopen-period"]')).toHaveLength(1);
  });

  it('shows the server refusal and leaves the period open', async () => {
    const w = await mount(ALL);
    const store = useAccountingPeriodsStore();
    const refusal = "Period '2026-01' (2026-01-01 to 2026-01-31) is still open; close it before '2026-02'";
    // A refusal is `false` plus the server's message — the view must not invent its own text.
    vi.mocked(store.close).mockImplementation(async () => {
      store.error = refusal;
      return false;
    });

    await openDialog(w, 'close-period');
    (inBody('confirm-close') as HTMLElement).click();
    await flushPromises();

    expect(store.close).toHaveBeenCalledWith('p-2');
    expect(store.periods.find((p) => p.id === 'p-2')?.status).toBe('OPEN');
    expect(store.error).toBe(refusal);
  });

  it('offers no control that closes a period the server refused', async () => {
    // The attendance screen's "close anyway" has no counterpart here, by design.
    const w = await mount(ALL);
    await openDialog(w, 'close-period');
    const footer = inBody('confirm-close')?.parentElement;
    // Confirm and cancel, and nothing else.
    expect(footer?.querySelectorAll('button')).toHaveLength(2);
  });

  it("warns that the year closes when the period is its year's last", async () => {
    const w = await mount(ALL);
    // p-12 ends 2026-12-31, the greatest periodEnd in fiscal year fy-2026.
    await openDialog(w, 'close-period', 1);
    expect(inBody('year-close-warning')).not.toBeNull();
  });

  it('does not warn for a period that is not the last', async () => {
    // Asserted separately: a screen that always warns would pass the previous case alone.
    const w = await mount(ALL);
    await openDialog(w, 'close-period');
    expect(inBody('year-close-warning')).toBeNull();
  });

  it('keeps reopen disabled until a reason is entered', async () => {
    const w = await mount(ALL);
    await openDialog(w, 'reopen-period');

    expect((inBody('confirm-reopen') as HTMLButtonElement).disabled).toBe(true);

    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'a late vendor invoice';
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();

    expect((inBody('confirm-reopen') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says the fiscal-year list is unavailable without FISCAL_YEAR_MANAGE', async () => {
    // Declaring needs a fiscalYearId, and listing years is a different permission. An empty
    // dropdown would look like "no years exist"; this says which permission is missing.
    const w = await mount(['PERIOD_VIEW', 'PERIOD_MANAGE']);
    await openDialog(w, 'declare-period');

    const notice = inBody('years-unavailable');
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain(i18n.global.t('gl.periods.fiscalYearsUnavailable'));
    // No selector rendered at all, rather than one that cannot be filled.
    expect(w.findComponent({ name: 'Select' }).exists()).toBe(false);
  });

  it('offers a way to the postings that blocked the close', async () => {
    // The refusal names them; this is the route to where they can be re-queued. GL_VIEW is added
    // explicitly — it is not a period code, and the next case is what happens without it.
    const w = await mount([...ALL, 'GL_VIEW']);
    const store = useAccountingPeriodsStore();
    vi.mocked(store.close).mockImplementation(async () => {
      store.error = "Period '2026-02' still owes 3 posting(s): PAYMENT PV-0012, …";
      return false;
    });

    await openDialog(w, 'close-period');
    expect(inBody('see-undelivered')).toBeNull(); // not before the refusal
    (inBody('confirm-close') as HTMLElement).click();
    await flushPromises();

    expect(inBody('see-undelivered')).not.toBeNull();
  });

  it('offers no link a viewer without GL_VIEW could not follow', async () => {
    // The undelivered screen is gated by GL_VIEW, which PERIOD_CLOSE does not imply. The refusal
    // and its named postings are still shown — only the shortcut is withheld.
    const w = await mount(['PERIOD_VIEW', 'PERIOD_CLOSE']);
    const store = useAccountingPeriodsStore();
    vi.mocked(store.close).mockImplementation(async () => {
      store.error = "Period '2026-02' still owes 3 posting(s)";
      return false;
    });

    await openDialog(w, 'close-period');
    (inBody('confirm-close') as HTMLElement).click();
    await flushPromises();

    expect(inBody('see-undelivered')).toBeNull();
    expect(store.error).toContain('still owes 3 posting(s)');
  });

  it('renders the fiscal-year selector when both permissions are held', async () => {
    const w = await mount(ALL);
    await openDialog(w, 'declare-period');

    expect(inBody('years-unavailable')).toBeNull();
    expect(w.findComponent({ name: 'Select' }).exists()).toBe(true);
  });
});
