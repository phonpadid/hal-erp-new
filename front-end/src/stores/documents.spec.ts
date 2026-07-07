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

  it('createDraft creates then writes fields and lines, returning the id', async () => {
    m.create.mockResolvedValueOnce({ id: 'd1' });
    m.setFields.mockResolvedValueOnce(undefined);
    m.setLines.mockResolvedValueOnce(undefined);
    const docs = useDocumentsStore();
    const id = await docs.createDraft({
      documentTypeId: 't1',
      fieldValues: [{ formFieldId: 'f1', value: 'x' }],
      lines: [{ lineNo: 1, description: 'a', qty: '1', unitPrice: '2', lineAmount: '2' }],
    });
    expect(id).toBe('d1');
    expect(m.setFields).toHaveBeenCalledWith('d1', [{ formFieldId: 'f1', value: 'x' }]);
    expect(m.setLines).toHaveBeenCalled();
  });

  it('submit success reloads and returns true', async () => {
    m.submit.mockResolvedValueOnce(undefined);
    m.get.mockResolvedValueOnce({ id: 'd1', status: 'SUBMITTED' });
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
