import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentsStore } from './documents';
import { documentsApi } from '../api/documents';

vi.mock('../api/documents', () => ({
  documentsApi: {
    list: vi.fn(),
    get: vi.fn(),
    detail: vi.fn(),
    approvalLog: vi.fn(),
    canAct: vi.fn(),
    sla: vi.fn(),
    pendingApprovers: vi.fn(),
    matching: vi.fn(),
    create: vi.fn(),
    setFields: vi.fn(),
    setLines: vi.fn(),
    setSelections: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
    creatableTypes: vi.fn(),
  },
}));

const m = documentsApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('useDocumentsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('loadList populates the list', async () => {
    m.list.mockResolvedValueOnce({
      items: [{ id: 'd1', docNo: 'PR-1', status: 'DRAFT' }],
      total: 1,
      page: 1,
      limit: 20,
    });
    const docs = useDocumentsStore();
    await docs.loadList();
    expect(docs.list).toHaveLength(1);
    expect(docs.total).toBe(1);
    expect(docs.error).toBe('');
  });

  // Regression: fields and lines used to follow the create as two more calls. A create that
  // succeeded and a setLines the server refused left a header-only draft behind, and the screen
  // made another on every retry. Everything travels in the one request the server applies
  // atomically; nothing is sent afterwards.
  it('createDraft sends header, fields and lines in one request and returns the id', async () => {
    m.create.mockResolvedValueOnce({ id: 'd1' });
    const docs = useDocumentsStore();
    const fieldValues = [{ formFieldId: 'f1', value: 'x' }];
    const lines = [{ lineNo: 1, description: 'a', qty: '1', unitPrice: '2', lineAmount: '2' }];
    const id = await docs.createDraft({ documentTypeId: 't1', fieldValues, lines });
    expect(id).toBe('d1');
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ documentTypeId: 't1', fieldValues, lines }));
    expect(m.setFields).not.toHaveBeenCalled();
    expect(m.setLines).not.toHaveBeenCalled();
  });

  it('createDraft leaves nothing to clean up when the server refuses the request', async () => {
    m.create.mockRejectedValueOnce(new Error('refused'));
    const docs = useDocumentsStore();
    await expect(docs.createDraft({ documentTypeId: 't1', lines: [] })).rejects.toThrow('refused');
    expect(m.setFields).not.toHaveBeenCalled();
    expect(m.setLines).not.toHaveBeenCalled();
  });

  // Regression: the payee was dropped here while every layer around it carried the field, so a
  // requires_payee document was created without one and the server rejected it at submit. The
  // payee is only settable at creation, so it has to travel with this call.
  it('createDraft forwards the payee bank account to the create call', async () => {
    m.create.mockResolvedValueOnce({ id: 'd2' });
    const docs = useDocumentsStore();
    await docs.createDraft({ documentTypeId: 't1', vendorId: 'v1', vendorBankAccountId: 'vba1' });
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ documentTypeId: 't1', vendorId: 'v1', vendorBankAccountId: 'vba1' }),
    );
  });

  it('submit success reloads full detail and returns true', async () => {
    // submit reloads via loadDetail (not loadOne) so the stepper/pending-approver panel
    // refresh too — the reload therefore hits `detail`, not `get`.
    m.submit.mockResolvedValueOnce(undefined);
    m.detail.mockResolvedValueOnce(detailPayload('SUBMITTED'));
    m.approvalLog.mockResolvedValueOnce([]);
    const docs = useDocumentsStore();
    expect(await docs.submit('d1')).toBe(true);
    expect(docs.current.status).toBe('SUBMITTED');
  });

  it('submit failure surfaces the server message and returns false', async () => {
    m.submit.mockRejectedValueOnce({ response: { data: { message: 'Over budget' } } });
    const docs = useDocumentsStore();
    expect(await docs.submit('d1')).toBe(false);
    expect(docs.error).toBe('Over budget');
  });

  const detailPayload = (status: string) => ({
    document: { id: 'd1', status },
    fieldValues: [],
    lines: [],
    attachments: [],
    refDocument: null,
  });

  it('loadDetail fetches pending approvers while IN_APPROVAL', async () => {
    m.detail.mockResolvedValueOnce(detailPayload('IN_APPROVAL'));
    m.approvalLog.mockResolvedValueOnce([]);
    m.canAct.mockResolvedValueOnce(false);
    m.sla.mockResolvedValueOnce(null);
    m.pendingApprovers.mockResolvedValueOnce({
      pending: { stepNo: 1, approveMode: 'SEQUENTIAL', roleName: 'Approver', approvers: [{ userId: 'u1', name: 'r1' }] },
    });
    const docs = useDocumentsStore();
    await docs.loadDetail('d1');
    expect(m.pendingApprovers).toHaveBeenCalledWith('d1');
    expect(docs.pendingApprovers?.roleName).toBe('Approver');
    expect(docs.pendingApprovers?.approvers).toHaveLength(1);
  });

  it('loadDetail leaves pending approvers null when not in approval', async () => {
    m.detail.mockResolvedValueOnce(detailPayload('DRAFT'));
    m.approvalLog.mockResolvedValueOnce([]);
    const docs = useDocumentsStore();
    await docs.loadDetail('d1');
    expect(m.pendingApprovers).not.toHaveBeenCalled();
    expect(docs.pendingApprovers).toBeNull();
  });

  it('applyFilters forwards the filters and resets to page 1', async () => {
    m.list.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20 });
    const docs = useDocumentsStore();
    docs.page = 5; // pretend the user had paged forward
    await docs.applyFilters({ status: ['SUBMITTED'], minAmount: '1000.00' });
    expect(m.list).toHaveBeenCalledWith(1, 20, { status: ['SUBMITTED'], minAmount: '1000.00' });
    expect(docs.filters).toEqual({ status: ['SUBMITTED'], minAmount: '1000.00' });
  });

  it('forwards amount bounds as strings, never coerced to a number', async () => {
    m.list.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20 });
    const docs = useDocumentsStore();
    await docs.applyFilters({ minAmount: '9007199254740993.01', maxAmount: '50' });
    const passed = m.list.mock.calls[0][2];
    expect(typeof passed.minAmount).toBe('string');
    expect(passed.minAmount).toBe('9007199254740993.01');
    expect(typeof passed.maxAmount).toBe('string');
  });

  it('clearFilters reloads the unfiltered list from page 1', async () => {
    m.list.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20 });
    const docs = useDocumentsStore();
    docs.filters = { status: ['DRAFT'] };
    await docs.clearFilters();
    expect(m.list).toHaveBeenCalledWith(1, 20, {});
    expect(docs.filters).toEqual({});
  });
});

describe('saveDraft carries the selections a draft\'s type asks for', () => {
  const fields = [{ formFieldId: 'f1', value: 'x' }];
  const lines: never[] = [];

  beforeEach(() => {
    setActivePinia(createPinia());
    // resetAllMocks, not clearAllMocks: these tests install implementations, and a leftover one
    // from the test before would answer for the test after.
    vi.resetAllMocks();
  });

  it('sends them before the fields and lines', async () => {
    // Order matters: the selections are what the submit gates read, so a failure to apply them
    // should stop the save rather than half-write it.
    const order: string[] = [];
    m.setSelections.mockImplementation(async () => void order.push('selections'));
    m.setFields.mockImplementation(async () => void order.push('fields'));
    m.setLines.mockImplementation(async () => void order.push('lines'));
    const docs = useDocumentsStore();

    await docs.saveDraft('d1', fields, lines, { warehouseId: 'w1' });

    expect(order).toEqual(['selections', 'fields', 'lines']);
    expect(m.setSelections).toHaveBeenCalledWith('d1', { warehouseId: 'w1' });
  });

  it('reports a failed selections write as a failed save, and writes nothing after it', async () => {
    // Reporting success here would be the worst outcome available: the user is told the warehouse
    // was saved, reopens the draft, and finds it blank again.
    m.setSelections.mockRejectedValueOnce(new Error('nope'));
    const docs = useDocumentsStore();

    expect(await docs.saveDraft('d1', fields, lines, { warehouseId: 'w1' })).toBe(false);
    expect(docs.error).toBeTruthy();
    expect(m.setFields).not.toHaveBeenCalled();
    expect(m.setLines).not.toHaveBeenCalled();
  });

  it('sends no selections request when a caller has none', async () => {
    // Every screen that does not collect them keeps the request count it had.
    const docs = useDocumentsStore();

    expect(await docs.saveDraft('d1', fields, lines)).toBe(true);

    expect(m.setSelections).not.toHaveBeenCalled();
    expect(m.setFields).toHaveBeenCalled();
  });

  it('sends an explicit null through, because clearing is not the same as not mentioning', async () => {
    const docs = useDocumentsStore();

    await docs.saveDraft('d1', fields, lines, { warehouseId: null });

    expect(m.setSelections).toHaveBeenCalledWith('d1', { warehouseId: null });
  });
});
