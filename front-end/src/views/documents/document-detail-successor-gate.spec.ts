import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import { useDocumentsStore } from '../../stores/documents';
import DocumentDetailView from './DocumentDetailView.vue';

type Spy = ReturnType<typeof vi.fn>;

const TYPES = [
  { id: 't-po', code: 'PO', name: 'Purchase Order', category: 'PROCUREMENT', requiresBudget: false, requiresQuota: false },
  { id: 't-disb', code: 'DISB', name: 'Disbursement', category: 'FINANCE', requiresBudget: false, requiresQuota: false },
];

vi.mock('../../api/documents', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    documentsApi: {
      ...(actual.documentsApi as object),
      creatableTypes: vi.fn(() => Promise.resolve(TYPES)),
    },
  };
});

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const PERMS = ['DOC_VIEW', 'DOC_CREATE'];

type Successor = { id: string; docNo: string; typeCode: string; status: string };

async function mount(successors: Successor[]) {
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'pr-1' },
    permissions: PERMS,
    extraRoutes: [{ path: '/documents/:id/edit', name: 'document-edit' }],
    initialState: {
      documents: {
        current: { id: 'pr-1', docNo: 'PR-1', status: 'COMPLETED', currency: { code: 'LAK', decimalPlaces: 0 } },
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        budgets: [], fieldValues: [], lines: [], attachments: [], refDocument: null, successors,
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

type Vm = {
  openCreateFrom: () => Promise<void>;
  confirmCreateFrom: () => Promise<void>;
  openTypes: Array<{ id: string; code: string }>;
  fromTypeId: string;
  fromDialog: boolean;
};

/**
 * A predecessor may have one live successor per type — the server refuses a second PO from the
 * same PR. The screen offers only the pairings still open and shows the successor that exists,
 * so a user is not handed a button the server would refuse.
 */
describe('document detail: create-successor offers only open pairings', () => {
  it('does not offer a type the document already has a live successor of, and links to it', async () => {
    const w = await mount([{ id: 'po-1', docNo: 'PO-7', typeCode: 'PO', status: 'DRAFT' }]);
    const vm = w.vm as unknown as Vm;

    await vm.openCreateFrom();
    await flushPromises();

    expect(vm.openTypes.map((t) => t.code)).toEqual(['DISB']);
    const links = w.find('[data-testid="doc-successors"]');
    expect(links.exists()).toBe(true);
    expect(links.text()).toContain('PO PO-7');
  });

  it('offers every type again once the successor is cancelled (the server omits it)', async () => {
    // A cancelled successor is not in the list at all: the server only reports live ones.
    const w = await mount([]);
    const vm = w.vm as unknown as Vm;

    await vm.openCreateFrom();
    await flushPromises();

    expect(vm.openTypes.map((t) => t.code)).toEqual(['PO', 'DISB']);
    expect(w.find('[data-testid="doc-successors"]').exists()).toBe(false);
  });

  it('says so when every creatable type is taken', async () => {
    const w = await mount([
      { id: 'po-1', docNo: 'PO-7', typeCode: 'PO', status: 'APPROVED' },
      { id: 'd-1', docNo: 'DISB-2', typeCode: 'DISB', status: 'SUBMITTED' },
    ]);
    const vm = w.vm as unknown as Vm;

    await vm.openCreateFrom();
    await flushPromises();

    expect(vm.openTypes).toEqual([]);
    expect(document.body.querySelector('[data-testid="all-pairings-taken"]')).not.toBeNull();
  });

  it('surfaces a refused create-from and re-reads the detail so the winner appears', async () => {
    const w = await mount([]);
    const vm = w.vm as unknown as Vm;
    const docs = useDocumentsStore();
    (docs.createFrom as Spy).mockRejectedValue(
      Object.assign(new Error('conflict'), { response: { status: 409, data: { message: 'PR-1 already has PO PO-8 (DRAFT)' } } }),
    );

    await vm.openCreateFrom();
    vm.fromTypeId = 't-po';
    await vm.confirmCreateFrom();
    await flushPromises();

    expect(docs.createFrom).toHaveBeenCalledWith('pr-1', 't-po');
    expect(docs.loadDetail).toHaveBeenCalledWith('pr-1');
    expect(vm.fromDialog).toBe(false);
  });
});
