import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../test/mountView';
import JournalView from './JournalView.vue';
import { useJournalStore } from '../stores/journal';
import type { JournalEntry } from '../api/journal';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  // PrimeVue dialogs teleport to the body and outlive the wrapper otherwise.
  document.body.innerHTML = '';
});

const entry = (over: Partial<JournalEntry>): JournalEntry => ({
  id: 'e-1',
  entryDate: '2026-08-10',
  sourceType: 'MANUAL_JV',
  sourceId: 's-1',
  memo: 'depreciation',
  lines: [
    { id: 'l-1', account: { code: '5000', name: 'Depreciation' }, debit: '1000.00', credit: '0' },
    { id: 'l-2', account: { code: '1500', name: 'Accum. Depreciation' }, debit: '0', credit: '1000.00' },
  ],
  ...over,
});

/**
 * A payment posting whose total the float implementation gets WRONG.
 *
 * `Math.round(Number('92233720368547.75') * 100) + Math.round(Number('0.01') * 100)`, divided back
 * by 100, is 92233720368547.77 — a cent too much. Ordinary two-decimal money, no sub-cent input:
 * the error is the double conversion through a JS number, which is the whole reason for the rule.
 */
const FLOATY = entry({
  id: 'e-2',
  sourceType: 'PAYMENT',
  memo: 'vendor payment',
  lines: [
    { id: 'l-3', account: { code: '2000', name: 'AP' }, debit: '92233720368547.75', credit: '0' },
    { id: 'l-4', account: { code: '1000', name: 'Cash' }, debit: '0.01', credit: '0' },
  ],
});

async function mount(permissions: string[], entries: JournalEntry[] = [entry({}), FLOATY]) {
  const w = await mountView(JournalView, {
    path: '/journal',
    routeName: 'journal',
    permissions,
    extraRoutes: [
      { path: '/journal/voucher', name: 'journal-voucher' },
      { path: '/documents/:id', name: 'document-detail' },
    ],
    initialState: { journal: { entries, total: entries.length, page: 1, limit: 20 } },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const inBody = (testid: string) => document.body.querySelector(`[data-testid="${testid}"]`);

describe('JournalView reversal', () => {
  it('offers no reverse or voucher control with GL_VIEW alone', async () => {
    const w = await mount(['GL_VIEW']);
    expect(w.find('[data-testid="reverse-entry"]').exists()).toBe(false);
    expect(w.find('[data-testid="new-voucher"]').exists()).toBe(false);
  });

  it('offers reverse on every entry to a GL_JV_POST holder, not only on manual ones', async () => {
    // A wrong AUTOMATIC posting is the likelier thing to correct.
    const w = await mount(['GL_VIEW', 'GL_JV_POST']);
    expect(w.findAll('[data-testid="reverse-entry"]')).toHaveLength(2);
    expect(w.find('[data-testid="new-voucher"]').exists()).toBe(true);
  });

  it('states the default date and the once-only rule before reversing', async () => {
    const w = await mount(['GL_VIEW', 'GL_JV_POST']);
    await w.findAll('[data-testid="reverse-entry"]')[0].trigger('click');
    await flushPromises();
    expect(inBody('reversal-notes')).not.toBeNull();
  });

  it('sends no date when none is picked, so the server dates it today', async () => {
    const w = await mount(['GL_VIEW', 'GL_JV_POST']);
    const store = useJournalStore();
    vi.mocked(store.reverse).mockResolvedValue(true);

    await w.findAll('[data-testid="reverse-entry"]')[0].trigger('click');
    await flushPromises();
    (inBody('confirm-reverse') as HTMLElement).click();
    await flushPromises();

    expect(store.reverse).toHaveBeenCalledWith('e-1', { entryDate: undefined, memo: undefined });
  });

  it('shows the server refusal when an entry was already reversed', async () => {
    const w = await mount(['GL_VIEW', 'GL_JV_POST']);
    const store = useJournalStore();
    const refusal = 'Journal entry e-1 has already been reversed by entry e-9';
    vi.mocked(store.reverse).mockImplementation(async () => {
      store.error = refusal;
      return false;
    });

    await w.findAll('[data-testid="reverse-entry"]')[0].trigger('click');
    await flushPromises();
    (inBody('confirm-reverse') as HTMLElement).click();
    await flushPromises();

    expect(store.error).toBe(refusal);
    // Left open: closing it would take the reason off the screen with it.
    expect(inBody('confirm-reverse')).not.toBeNull();
  });
});

describe('JournalView entry total', () => {
  // Predates the voucher work; kept because it pins what the total LOOKS like, which the move to
  // `sumAmounts` would otherwise have quietly changed — a bare Decimal renders 100000.00 as
  // '100000'.
  it('renders a journal entry with its source, memo, and balanced total', async () => {
    const w = await mount(['GL_VIEW'], [
      entry({
        id: 'e1',
        sourceType: 'PAYMENT',
        sourceId: 'doc-1',
        memo: 'Settlement of document doc-1',
        lines: [
          { id: 'l1', account: { code: '5000', name: 'Office Supplies Expense' }, debit: '100000.00', credit: '0.00' },
          { id: 'l2', account: { code: '1000', name: 'Cash' }, debit: '0.00', credit: '100000.00' },
        ],
      }),
    ]);
    const text = w.text();
    expect(text).toContain('PAYMENT');
    expect(text).toContain('Settlement of document doc-1');
    // Σ debit, at the base currency's decimal places — not '100000'.
    expect(text).toContain('100,000.00');
  });

  it('sums line debits as decimals rather than through a JS number', async () => {
    const w = await mount(['GL_VIEW']);
    const text = w.text();
    expect(text).toContain('92,233,720,368,547.76');
    // What the float implementation rendered: a cent too much.
    expect(text).not.toContain('92,233,720,368,547.77');
  });
});
