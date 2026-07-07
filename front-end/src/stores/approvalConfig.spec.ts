import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { delegationSchema } from '@erp/shared';
import { useApprovalConfigStore } from './approvalConfig';
import { approvalConfigApi } from '../api/approvalConfig';

vi.mock('../api/approvalConfig', () => ({
  approvalConfigApi: {
    delegations: { list: vi.fn(), create: vi.fn(), cancel: vi.fn() },
    users: vi.fn(),
    documentTypes: vi.fn(),
  },
}));

const a = approvalConfigApi as any;
const UUID = '11111111-1111-1111-1111-111111111111';

describe('delegation shared schema', () => {
  it('accepts a valid delegation', () => {
    expect(delegationSchema.safeParse({ delegatorId: UUID, delegateId: UUID, startDate: '2026-01-01', endDate: '2026-12-31' }).success).toBe(true);
  });
  it('rejects missing delegate and missing dates', () => {
    expect(delegationSchema.safeParse({ delegatorId: UUID, startDate: '2026-01-01', endDate: '2026-12-31' }).success).toBe(false);
    expect(delegationSchema.safeParse({ delegatorId: UUID, delegateId: UUID }).success).toBe(false);
  });
});

describe('useApprovalConfigStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    a.delegations.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    a.users.mockResolvedValue([]);
    a.documentTypes.mockResolvedValue([]);
  });

  it('loadAll populates delegations, users and document types', async () => {
    a.delegations.list.mockResolvedValueOnce({ items: [{ id: 'd1', status: 'ACTIVE' }], total: 1, page: 1, limit: 20 });
    a.users.mockResolvedValueOnce([{ id: 'u1', username: 'admin' }]);
    a.documentTypes.mockResolvedValueOnce([{ id: 't1', code: 'PR' }]);
    const s = useApprovalConfigStore();
    await s.loadAll();
    expect(s.delegations).toHaveLength(1);
    expect(s.users).toHaveLength(1);
    expect(s.documentTypes).toHaveLength(1);
  });

  it('create + cancel call the endpoint and refresh', async () => {
    a.delegations.create.mockResolvedValueOnce(undefined);
    a.delegations.cancel.mockResolvedValueOnce(undefined);
    const s = useApprovalConfigStore();
    expect(await s.createDelegation({ delegatorId: UUID, delegateId: UUID, startDate: '2026-01-01', endDate: '2026-12-31' })).toBe(true);
    expect(a.delegations.create).toHaveBeenCalled();
    await s.cancelDelegation('d1');
    expect(a.delegations.cancel).toHaveBeenCalledWith('d1');
    expect(a.delegations.list).toHaveBeenCalled(); // refreshed
  });

  it('captures a server error and returns false', async () => {
    a.delegations.cancel.mockRejectedValueOnce({ response: { data: { message: 'not found' } } });
    const s = useApprovalConfigStore();
    expect(await s.cancelDelegation('x')).toBe(false);
    expect(s.error).toBe('not found');
  });
});
