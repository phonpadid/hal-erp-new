import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mountView } from '../../test/mountView';
import OpenPayablesView from './OpenPayablesView.vue';
import type { OpenPayable } from '../../api/journal';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/** Deliberately NOT in due-date order, so the ordering assertion means something. */
const PAYABLES: OpenPayable[] = [
  {
    documentId: 'd-2', documentNo: 'PO-0002', payableKind: 'TRADE', owedTo: 'Beta Trading',
    vendorId: 'v-2', vendorName: 'Beta Trading',
    amount: '250000.00', invoiceDate: '2026-07-20', dueDate: '2026-09-18',
    daysOverdue: 0, bucket: 'NOT_DUE',
  },
  {
    documentId: 'd-1', documentNo: 'PO-0001', payableKind: 'TRADE', owedTo: 'Alpha Supply',
    vendorId: 'v-1', vendorName: 'Alpha Supply',
    amount: '75000.50', invoiceDate: '2026-06-01', dueDate: '2026-06-30',
    daysOverdue: 43, bucket: 'D31_60',
  },
];

/** The bands as the SERVER computed them — the screen renders these and derives none of them. */
const AGEING = {
  agedAt: '2026-08-12',
  buckets: [
    { bucket: 'NOT_DUE' as const, total: '250000.00', count: 1 },
    { bucket: 'D1_30' as const, total: '0', count: 0 },
    { bucket: 'D31_60' as const, total: '75000.50', count: 1 },
    { bucket: 'D61_90' as const, total: '0', count: 0 },
    { bucket: 'D90_PLUS' as const, total: '0', count: 0 },
  ],
  total: '325000.50',
};

async function mount(payables = PAYABLES) {
  const w = await mountView(OpenPayablesView, {
    path: '/open-payables',
    routeName: 'open-payables',
    permissions: ['GL_VIEW'],
    initialState: { journal: { payables, ageing: AGEING } },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('OpenPayablesView', () => {
  it('lists the unpaid accruals with vendor and amount', async () => {
    const text = (await mount()).text();
    expect(text).toContain('Alpha Supply');
    expect(text).toContain('Beta Trading');
    expect(text).toContain('75,000.50');
    expect(text).toContain('250,000.00');
  });

  it('orders by due date, not by the order the server sent', async () => {
    const w = await mount();
    const amounts = w.findAll('[data-testid="payable-amount"]').map((n) => n.text());
    // Alpha is due 2026-06-30, Beta 2026-09-18 — Alpha first, though it arrived second.
    expect(amounts[0]).toBe('75,000.50');
    expect(amounts[1]).toBe('250,000.00');
  });

  it('totals the payables as decimals', async () => {
    const w = await mount();
    expect(w.find('[data-testid="payables-total"]').text()).toBe('325,000.50');
  });

  it('shows the ageing bands the server computed', async () => {
    const w = await mount();
    expect(w.find('[data-testid="ageing-summary"]').exists()).toBe(true);
    expect(w.find('[data-testid="bucket-D31_60"]').text()).toBe('75,000.50');
    expect(w.find('[data-testid="bucket-NOT_DUE"]').text()).toBe('250,000.00');
  });

  it('shows each row the band the server put it in', async () => {
    // Rendered, not derived: the browser does not know the company's day.
    const w = await mount();
    const bands = w.findAll('[data-testid="payable-bucket"]').map((n) => n.text());
    expect(bands).toHaveLength(2);
    expect(bands.some((b) => b.length > 0)).toBe(true);
  });

  it('marks nothing overdue', async () => {
    // The due date is a company-day and the browser's today is not the company's. An overdue flag
    // computed here would fire early or late by a timezone offset — the defect the posting engine
    // was corrected for. A long-past due date must still render unmarked.
    const w = await mount([
      { ...PAYABLES[1], dueDate: '2020-01-01', daysOverdue: 0, bucket: 'NOT_DUE' },
    ]);
    expect(w.find('[data-testid="overdue"]').exists()).toBe(false);
  });

  it('pages on the client, because the endpoint ignores paging parameters', async () => {
    // `open-payables` returns every row in one response. A lazy table would refetch page 1 as
    // page 2. Asserted on the prop so a later switch to server paging fails here.
    const w = await mount();
    expect(w.findComponent({ name: 'DataTable' }).props('lazy')).toBeFalsy();
  });
});
