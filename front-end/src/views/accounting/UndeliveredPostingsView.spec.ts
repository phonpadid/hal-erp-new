import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView } from '../../test/mountView';
import UndeliveredPostingsView from './UndeliveredPostingsView.vue';
import { useJournalStore } from '../../stores/journal';
import type { UndeliveredPosting } from '../../api/journal';
import type { VueWrapper } from '@vue/test-utils';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
});

/** FAILED first, PENDING second — the row order the assertions index into. */
const ROWS: UndeliveredPosting[] = [
  {
    id: 'a-1',
    sourceType: 'PAYMENT',
    sourceId: 'doc-1',
    sourceDocNo: 'PV-0012',
    status: 'FAILED',
    attempts: 5,
    lastError: 'Account role ACCOUNTS_PAYABLE is not mapped',
    lastAttemptAt: '2026-08-10T04:00:00.000Z',
  },
  {
    id: 'a-2',
    sourceType: 'STOCK_TXN',
    sourceId: 'doc-2',
    sourceDocNo: 'GRN-0007',
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    lastAttemptAt: null,
  },
];

async function mount(permissions: string[], rows = ROWS) {
  const w = await mountView(UndeliveredPostingsView, {
    path: '/journal/undelivered',
    routeName: 'journal-undelivered',
    permissions,
    initialState: {
      journal: { undelivered: rows, undeliveredTotal: rows.length, undeliveredPage: 1, undeliveredLimit: 20 },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('UndeliveredPostingsView', () => {
  it('lists what the ledger owes, with the error that stopped it', async () => {
    const text = (await mount(['GL_VIEW'])).text();
    expect(text).toContain('PV-0012');
    expect(text).toContain('GRN-0007');
    expect(text).toContain('Account role ACCOUNTS_PAYABLE is not mapped');
  });

  it('shows the attempt count against the bound that stopped it', async () => {
    // '5' alone does not say "this gave up"; '5 / 5' does.
    const w = await mount(['GL_VIEW']);
    expect(w.findAll('[data-testid="attempts"]')[0].text()).toBe('5 / 5');
  });

  it('offers re-queue on a FAILED posting to a holder of GL_POST_RETRY', async () => {
    const w = await mount(['GL_VIEW', 'GL_POST_RETRY']);
    const buttons = w.findAll('[data-testid="requeue"]');
    // Exactly one: the FAILED row. The PENDING row is queued, not stalled — the server refuses to
    // re-queue it, so a control there could only fail.
    expect(buttons).toHaveLength(1);
  });

  it('offers no re-queue without GL_POST_RETRY, even on a FAILED posting', async () => {
    const w = await mount(['GL_VIEW']);
    expect(w.findAll('[data-testid="requeue"]')).toHaveLength(0);
  });

  it('re-queues the row it was clicked on', async () => {
    const w = await mount(['GL_VIEW', 'GL_POST_RETRY']);
    const store = useJournalStore();
    vi.mocked(store.requeue).mockResolvedValue(true);

    await w.find('[data-testid="requeue"]').trigger('click');
    await flushPromises();

    expect(store.requeue).toHaveBeenCalledWith('a-1');
  });

  it('shows the server refusal when a re-queue is rejected', async () => {
    const w = await mount(['GL_VIEW', 'GL_POST_RETRY']);
    const store = useJournalStore();
    const refusal = 'Posting attempt a-1 is SKIPPED; only a FAILED posting can be re-queued';
    vi.mocked(store.requeue).mockImplementation(async () => {
      store.error = refusal;
      return false;
    });

    await w.find('[data-testid="requeue"]').trigger('click');
    await flushPromises();

    expect(store.error).toBe(refusal);
  });
});
