import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VueWrapper } from '@vue/test-utils';
import { mountView } from '../../test/mountView';
import { documentsApi } from '../../api/documents';
import { useDocumentsStore } from '../../stores/documents';
import DocumentDetailView from './DocumentDetailView.vue';

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

const PENCIL = '[data-testid="recode-line"]';
const NOTE = '[data-testid="recode-blocked-by-step"]';

const LINE = {
  lineNo: 1,
  description: 'Coffee beans',
  qty: '1',
  unit: 'ea',
  unitPrice: '250',
  lineAmount: '250',
  glAccount: '606.03',
  account: { id: 'acc-606', code: '606.03' },
};
const ZERO_LINE = { ...LINE, lineNo: 2, description: 'note', unitPrice: '0', lineAmount: '0' };

async function mount(over: {
  permissions?: string[];
  status?: string;
  canAct?: boolean;
  accountRecodeAllowed?: boolean;
  canRecodeAccount?: boolean;
  lines?: Array<Record<string, unknown>>;
  approvalLog?: Array<Record<string, unknown>>;
} = {}) {
  const permissions = over.permissions ?? ['DOC_VIEW', 'DOC_APPROVE', 'DOC_LINE_RECODE'];
  const w = await mountView(DocumentDetailView, {
    path: '/documents/:id',
    routeName: 'document-detail',
    routeParams: { id: 'doc-1' },
    permissions,
    initialState: {
      documents: {
        current: {
          id: 'doc-1', docNo: 'D-1', status: over.status ?? 'IN_APPROVAL', currentStepNo: 1,
          createdBy: { id: 'u-requester', username: 'requester' },
        },
        hasPayment: false, hasSlip: false, slipRequired: false, canRestateRate: false,
        accountRecodeAllowed: over.accountRecodeAllowed ?? true,
        canRecodeAccount: over.canRecodeAccount ?? true,
        budgets: [],
        fieldValues: [], lines: over.lines ?? [LINE, ZERO_LINE], attachments: [], refDocument: null,
        approvalLog: over.approvalLog ?? [], canAct: over.canAct ?? true, sla: null, pendingApprovers: null, matching: null,
        loading: false, error: '',
      },
      auth: { permissions, userId: 'u-accountant', baseCurrency: { code: 'LAK', decimalPlaces: 0 } },
    },
  });
  await flushPromises();
  wrapper = w;
  return w;
}

/**
 * The accountant re-codes a line's account where they act — on the document detail — and only
 * where the server says they may. The server is the authority; the screen mirrors its gates so the
 * control is offered exactly where a request would succeed, and explains itself where it is not.
 */
describe('document detail: re-coding a line account at an allowing step', () => {
  it('offers the control on each priced line to the eligible, permitted approver', async () => {
    const w = await mount();
    const pencils = w.findAll(PENCIL);
    expect(pencils).toHaveLength(1);
    expect(pencils[0].attributes('data-line')).toBe('1');
    expect(w.find(NOTE).exists()).toBe(false);
  });

  it('withholds the control from an approver without DOC_LINE_RECODE', async () => {
    const w = await mount({ permissions: ['DOC_VIEW', 'DOC_APPROVE'] });
    expect(w.find(PENCIL).exists()).toBe(false);
    expect(w.text()).toContain('606.03');
    expect(w.find(NOTE).exists()).toBe(false);
  });

  it('withholds the control when the server says this viewer may not', async () => {
    // Not this step's approver, or the document is no longer in approval: the read says so.
    const w = await mount({ canRecodeAccount: false, canAct: false });
    expect(w.find(PENCIL).exists()).toBe(false);
    expect(w.find(NOTE).exists()).toBe(false);
  });

  it('tells an approver on a step that does not allow it why there is no control', async () => {
    const w = await mount({ accountRecodeAllowed: false, canRecodeAccount: false, canAct: true });
    expect(w.find(PENCIL).exists()).toBe(false);
    expect(w.find(NOTE).exists()).toBe(true);
  });

  it('says nothing about the step to a viewer who cannot act', async () => {
    const w = await mount({ accountRecodeAllowed: false, canRecodeAccount: false, canAct: false });
    expect(w.find(NOTE).exists()).toBe(false);
  });

  it('shows the current account, submits the pick, and refetches the detail', async () => {
    const recode = vi.spyOn(documentsApi, 'recodeLineAccount').mockResolvedValue({
      documentId: 'doc-1', lineNo: 1, from: { id: 'acc-606', code: '606.03' }, to: { id: 'acc-636', code: '636.04' },
    });
    const w = await mount();
    // Store actions are stubbed by @pinia/testing: the refetch is the store's `loadDetail`, and
    // what the screen owes is to ask for it once the server has answered.
    const docs = useDocumentsStore();
    const reload = vi.mocked(docs.loadDetail).mockImplementation(async () => {
      docs.lines = [{ ...LINE, glAccount: '636.04', account: { id: 'acc-636', code: '636.04' } }] as never;
    });

    await w.find(PENCIL).trigger('click');
    await flushPromises();
    expect(document.querySelector('[data-testid="recode-current"]')?.textContent).toContain('606.03');

    // Drive the confirm through the component: the picker is a PrimeVue Select rendered in a
    // teleported dialog, so set the model directly and confirm.
    (w.vm as any).recodeDialog.accountId = 'acc-636';
    await flushPromises();
    (document.querySelector('[data-testid="recode-confirm"]') as HTMLElement).click();
    await flushPromises();

    expect(recode).toHaveBeenCalledWith('doc-1', 1, 'acc-636');
    expect(reload).toHaveBeenCalledWith('doc-1');
    expect(w.text()).toContain('636.04');
  });

  it("shows the server's reason and leaves the line as it was when the recode is refused", async () => {
    vi.spyOn(documentsApi, 'recodeLineAccount').mockRejectedValue({
      response: { data: { message: 'Document D-1 is COMPLETED; a line\'s account can only be re-coded while it is in approval' } },
    });
    const w = await mount();
    const docs = useDocumentsStore();
    // The mount itself asks for the detail once; a refused recode must not ask again.
    const loadsBefore = vi.mocked(docs.loadDetail).mock.calls.length;
    await w.find(PENCIL).trigger('click');
    await flushPromises();
    (w.vm as any).recodeDialog.accountId = 'acc-636';
    await flushPromises();
    (document.querySelector('[data-testid="recode-confirm"]') as HTMLElement).click();
    await flushPromises();

    expect(vi.mocked(docs.loadDetail).mock.calls.length).toBe(loadsBefore);
    expect(w.text()).toContain('606.03');
    expect(w.text()).not.toContain('636.04');
  });

  it('renders a RECODE_ACCOUNT row in the history in the approver\'s terms', async () => {
    const w = await mount({
      approvalLog: [
        { id: 'l1', stepNo: 1, action: 'APPROVE', remark: null, actedAt: '2026-09-11T01:00:00Z', approver: { id: 'u1', username: 'dept_head' }, delegatedFrom: null },
        { id: 'l2', stepNo: 5, action: 'RECODE_ACCOUNT', remark: 'line 1: 606.03 → 636.04', actedAt: '2026-09-11T02:00:00Z', approver: { id: 'u-accountant', username: 'accountant' }, delegatedFrom: null },
      ],
    });
    const text = w.text();
    // A localised label, not the raw action code; the remark carries the move itself.
    expect(text).not.toContain('RECODE_ACCOUNT');
    expect(text).toContain('line 1: 606.03 → 636.04');
    expect(text).toContain('accountant');
  });
});
