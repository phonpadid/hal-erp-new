import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import DocumentDetailView from './DocumentDetailView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const PERMS = ['DOC_VIEW'];

const LINE = {
  lineNo: 1,
  description: 'Electricity',
  qty: '1',
  unit: 'ea',
  unitPrice: '250',
  lineAmount: '250',
  glAccount: '5210',
};

async function mount(over: {
  lines?: Array<Record<string, unknown>>;
  budgets?: Array<{ id: string; name: string; amountTotal: string; available: string; charged: string }>;
} = {}) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: { id: 'doc-1', docNo: 'D-1', status: 'COMPLETED' },
        hasPayment: false, hasSlip: false, slipRequired: false,
        budgets: over.budgets ?? [],
        fieldValues: [], lines: over.lines ?? [], attachments: [], refDocument: null,
        approvalLog: [], canAct: false, sla: null, pendingApprovers: null, matching: null,
        loading: false, error: '',
      },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

/**
 * Which pot a line charges belongs beside the account it posts to: both are part of reading the
 * line, and sending the reader elsewhere to find out is how a document gets approved against a
 * budget nobody looked at.
 */
describe('document detail: the budget each line charges', () => {
  const BUDGET = { id: 'b1', name: 'Utilities', amountTotal: '1000000', available: '750000', charged: '250000' };

  it('names the budget on the line that charges it', async () => {
    const w = await mount({ lines: [{ ...LINE, budget: { id: 'b1' } }], budgets: [BUDGET] });
    expect(w.find('[data-testid="line-budget"]').text()).toBe('Utilities');
  });

  it('takes the name the server resolved, so the column and the panel agree', async () => {
    // The line's own populated entity carries a `budgetName`; the column deliberately ignores it and
    // reads the detail response's list, which is the one place a budget gets named.
    const w = await mount({
      lines: [{ ...LINE, budget: { id: 'b1', budgetName: 'STALE NAME' } }],
      budgets: [BUDGET],
    });
    expect(w.find('[data-testid="line-budget"]').text()).toBe('Utilities');
  });

  it('hides the column entirely when no line charges a budget', async () => {
    // A column of dashes is a wall the reader has to look past, so it is not rendered at all.
    const w = await mount({ lines: [LINE], budgets: [] });
    expect(w.find('[data-testid="line-budget"]').exists()).toBe(false);
    expect(w.text()).not.toContain('Utilities');
  });

  it('shows a dash for a line charging none, beside lines that do', async () => {
    const w = await mount({
      lines: [{ ...LINE, budget: { id: 'b1' } }, { ...LINE, lineNo: 2, description: 'note' }],
      budgets: [BUDGET],
    });
    // The column exists because one line charges a budget; the other line simply has nothing to say.
    expect(w.findAll('[data-testid="line-budget"]')).toHaveLength(1);
  });
});
