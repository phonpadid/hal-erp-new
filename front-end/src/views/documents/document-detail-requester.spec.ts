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

async function mount(requesterName: string | null, requesterDepartment: string | null) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions: PERMS,
    initialState: {
      documents: {
        current: { id: 'doc-1', docNo: 'D-1', status: 'IN_APPROVAL', currency: { code: 'LAK', decimalPlaces: 0 } },
        requesterName, requesterDepartment,
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues: [], lines: [], attachments: [], refDocument: null,
        approvalLog: [], canAct: false, sla: null, pendingApprovers: null, matching: null,
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

/**
 * An approver opening a document has to see who raised it without going back to the list — the
 * header named the dates and the vendor, but never the person.
 */
describe('document detail: the header names the requester', () => {
  it('shows the requester and their department', async () => {
    const w = await mount('ທ້າວ ສົມຊາຍ ວົງສາ', 'ການເງິນ');
    const el = w.find('[data-testid="doc-requester"]');
    expect(el.text()).toContain('ທ້າວ ສົມຊາຍ ວົງສາ');
    expect(el.text()).toContain('ການເງິນ');
  });

  it('shows the name alone when it fell back to a username', async () => {
    const w = await mount('admin', null);
    const el = w.find('[data-testid="doc-requester"]');
    expect(el.text()).toContain('admin');
    expect(el.text()).not.toContain('·');
  });

  it('shows nothing when the server could name nobody', async () => {
    const w = await mount(null, null);
    expect(w.find('[data-testid="doc-requester"]').exists()).toBe(false);
  });
});
