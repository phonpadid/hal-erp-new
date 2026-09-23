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

const PERMS = ['DOC_VIEW', 'DOC_CANCEL'];

/**
 * Who is offered the withdraw button.
 *
 * It used to be derived here, by comparing the document's creator with the signed-in user. That was
 * the rule at the time, and it could not survive a document the CREATE_SUCCESSOR sweep raises: such
 * a document's `created_by` is the predecessor's requester, in one department, while its
 * `department` is the successor's. The only person the button was offered to was often the one who
 * could not even see the document, while the department that owned the work saw it and was offered
 * nothing.
 *
 * Withdrawal is now authorized by `DOC_CANCEL` at the holder's granted scope — a rule the client
 * cannot evaluate without the grant's scope and the reader's department set, and one that must not
 * have two implementations. So the server answers it, as `canCancel`, and these assert the button
 * follows that answer rather than any local notion of who raised the document.
 */
async function mount(opts: {
  canCancel: boolean;
  createdBy?: string;
  status?: string;
  permissions?: string[];
}) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: opts.permissions ?? PERMS,
    initialState: {
      documents: {
        current: {
          id: 'doc-1',
          docNo: 'PO-1',
          status: opts.status ?? 'DRAFT',
          createdBy: opts.createdBy ?? 'someone-else',
          currency: { code: 'LAK', decimalPlaces: 0 },
        },
        canCancel: opts.canCancel,
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues: [], lines: [], attachments: [], refDocument: null,
        approvalLog: [], canAct: false, sla: null, pendingApprovers: null, matching: null,
        budgetMovements: [], loading: false, error: '',
      },
      auth: { permissions: opts.permissions ?? PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      currency: { currencies: [{ code: 'LAK', decimalPlaces: 0 }] },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

describe('the withdraw button follows the server, not the creator', () => {
  it('offers it on a document this reader did not raise', async () => {
    // The whole point: procurement withdrawing the duplicate PO the sweep put in their queue, which
    // records the requester of the PR as its creator.
    const w = await mount({ canCancel: true, createdBy: 'the-pr-requester' });

    expect(w.find('[data-testid="cancel-btn"]').exists()).toBe(true);
  });

  it('withholds it when the server says the reader may not', async () => {
    const w = await mount({ canCancel: false, createdBy: 'the-pr-requester' });

    expect(w.find('[data-testid="cancel-btn"]').exists()).toBe(false);
  });

  it('withholds it on a document the reader DID raise when the status forbids it', async () => {
    // The status gate lives with the scope gate on the server, so a creator is not a special case.
    const w = await mount({ canCancel: false, createdBy: 'me', status: 'COMPLETED' });

    expect(w.find('[data-testid="cancel-btn"]').exists()).toBe(false);
  });

  it('still offers it to a creator withdrawing their own draft', async () => {
    // The case that worked before this change must go on working.
    const w = await mount({ canCancel: true, createdBy: 'me' });

    expect(w.find('[data-testid="cancel-btn"]').exists()).toBe(true);
  });

  it('withholds it from a reader who holds no DOC_CANCEL at all', async () => {
    // `auth.can` stays the affordance-level guard every other button uses. A server that answered
    // true for someone holding nothing would be a bug, but the control must not depend on that.
    const w = await mount({ canCancel: true, permissions: ['DOC_VIEW'] });

    expect(w.find('[data-testid="cancel-btn"]').exists()).toBe(false);
  });
});
