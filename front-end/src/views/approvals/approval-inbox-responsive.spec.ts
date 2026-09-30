import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import ApprovalInboxView from './ApprovalInboxView.vue';
import type { PendingApproval } from '../../api/approvals';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

const ROW: PendingApproval = {
  id: 'doc-1',
  docNo: 'BUDGET_PLAN-HAL-2026-0026',
  documentType: { code: 'BUDGET_PLAN', name: 'ແຜນງົບປະມານ' },
  requesterName: 'LATTANAPHONE',
  requesterDepartment: null,
  baseTotalAmount: '1000000',
  currentStepNo: 1,
  submittedAt: '2026-09-12T00:00:00.000Z',
  slaDueAt: null,
  overdue: false,
  intake: { received: false, receivedByName: null, receivedAt: null, canReceive: false },
  hasSlip: false,
};

async function mount() {
  const w = await mountView(ApprovalInboxView, {
    path: '/approvals',
    routeName: 'approvals',
    permissions: ['DOC_APPROVE', 'DOC_VIEW'],
    initialState: {
      approvals: { pending: [ROW], total: 1, page: 1, limit: 20, loading: false, error: '', search: '' },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

/**
 * The inbox is the one list a phone user opens to DO something rather than to read, and it shipped
 * without a single `data-priority`. All nine of its columns therefore took an equal share of a
 * 375px viewport — about 30px each — and Lao, written without spaces, has no break opportunity
 * inside a word, so every header and value stacked one character per line and the approve button
 * wrapped inside a box barely wider than its own tick.
 *
 * These assert the markup the narrow layout is derived from, not the pixels: the wrapper turns
 * these tags into the card layout, and `AppDataTable.responsive.spec.ts` covers that translation.
 */
describe('approval inbox on a phone', () => {
  it('leads each row with the document number', async () => {
    const w = await mount();
    const identity = w.find('td.app-col-identity');
    expect(identity.exists()).toBe(true);
    expect(identity.text()).toContain('BUDGET_PLAN-HAL-2026-0026');
  });

  it('keeps the approve button at every width — a queue you cannot act on is not an inbox', async () => {
    const w = await mount();
    const actions = w.find('td.app-col-actions');
    expect(actions.exists()).toBe(true);
    expect(actions.find('button').exists()).toBe(true);
    // The label is hidden below `md`, so the name has to survive somewhere assistive tech reads.
    expect(actions.find('button').attributes('aria-label')).toBeTruthy();
  });

  it('folds the columns an approver does not triage on into the row expander', async () => {
    const w = await mount();
    // Type, requester, step, submitted and SLA — five of the nine (the row ordinal is hidden
    // below `md` too, but by the wrapper rather than by this view's markup).
    const folded = w.findAll('td.app-col-secondary');
    expect(folded.length).toBe(5);
    expect(folded.every((c) => c.classes().includes('hidden'))).toBe(true);
    // …and the expander that reaches them exists.
    expect(w.find('.app-col-expander').exists()).toBe(true);
  });

  it('still shows the amount, which is what an approver decides on', async () => {
    const w = await mount();
    const detail = w.find('td.app-col-detail');
    expect(detail.exists()).toBe(true);
    expect(detail.attributes('style')).toContain('--app-col-label');
  });
});
