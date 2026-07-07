import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { mountView } from '../test/mountView';
import JournalView from './JournalView.vue';

const ENTRIES = [
  {
    id: 'e1',
    entryDate: '2026-07-07',
    sourceType: 'PAYMENT',
    sourceId: 'doc-1',
    memo: 'Settlement of document doc-1',
    lines: [
      { id: 'l1', account: { code: '5000', name: 'Office Supplies Expense' }, debit: '100000.00', credit: '0.00' },
      { id: 'l2', account: { code: '1000', name: 'Cash' }, debit: '0.00', credit: '100000.00' },
    ],
  },
];

async function mount() {
  const w = await mountView(JournalView, {
    path: '/journal',
    routeName: 'journal',
    permissions: ['GL_VIEW'],
    initialState: { journal: { entries: ENTRIES } },
  });
  await flushPromises();
  return w;
}

describe('JournalView', () => {
  it('renders a journal entry with its source, memo, and balanced total', async () => {
    const w = await mount();
    const text = w.text();
    expect(text).toContain('PAYMENT');
    expect(text).toContain('Settlement of document doc-1');
    // entryTotal = Σ debit = 100000.00 (equals Σ credit for a balanced entry)
    expect(text).toContain('100000.00');
  });
});
