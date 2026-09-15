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

async function mount(approvalLog: Array<Record<string, unknown>>) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: { id: 'doc-1', docNo: 'D-1', status: 'COMPLETED', currency: { code: 'LAK', decimalPlaces: 0 } },
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues: [], lines: [], attachments: [], refDocument: null,
        approvalLog, canAct: false, sla: null, pendingApprovers: null, matching: null,
        budgetMovements: [], loading: false, error: '',
      },
      auth: { permissions: PERMS, baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
      currency: { currencies: [{ code: 'LAK', decimalPlaces: 0 }] },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

const ENTRY = (approver: Record<string, unknown>) => ({
  id: 'l1', stepNo: 1, action: 'APPROVE', remark: null,
  actedAt: '2026-09-11T09:40:00.000Z', approver, delegatedFrom: null,
});

/**
 * The approval history is read by people asking who signed. It named the login account, so a trail
 * of `xone`, `kai` and `finance_head` said which credentials were used rather than which people
 * approved — and nobody outside IT can map those back to a colleague.
 */
describe('document detail: the approval trail names the person', () => {
  it('shows the approver full name the server resolved', async () => {
    const w = await mount([ENTRY({ id: 'u1', username: 'finance_head', name: 'ທ້າວ ສົມຊາຍ ວົງສາ' })]);
    expect(w.text()).toContain('ທ້າວ ສົມຊາຍ ວົງສາ');
    expect(w.text()).not.toContain('finance_head');
  });

  it('falls back to the username for an account with no employee record', async () => {
    // A bootstrap or integration account still has to read as somebody, not as a blank line.
    const w = await mount([ENTRY({ id: 'u1', username: 'admin', name: null })]);
    expect(w.text()).toContain('admin');
  });
});
