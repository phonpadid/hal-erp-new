import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onboardEmployeeSchema, verifyEmailSchema } from '@erp/shared';
import { useEmployeeAdminStore } from './employeeAdmin';
import { employeesApi } from '../api/employees';

vi.mock('../api/employees', () => ({
  employeesApi: {
    list: vi.fn(),
    link: vi.fn(),
    linkableAccounts: vi.fn(),
    onboard: vi.fn(),
    verifyAccount: vi.fn(),
  },
}));

const api = employeesApi as any;

describe('useEmployeeAdminStore — linkable accounts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    api.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  });

  it('loadLinkable populates the picker source and passes the search term', async () => {
    api.linkableAccounts.mockResolvedValueOnce([
      { id: 'u1', username: 'alice', email: 'alice@x' },
    ]);
    const s = useEmployeeAdminStore();
    await s.loadLinkable('ali');
    expect(api.linkableAccounts).toHaveBeenCalledWith('ali');
    expect(s.linkable).toHaveLength(1);
    expect(s.linkable[0].username).toBe('alice');
    expect(s.linkableLoading).toBe(false);
  });

  it('leaves the picker empty on error (empty-state path)', async () => {
    api.linkableAccounts.mockRejectedValueOnce({ response: { data: { message: 'nope' } } });
    const s = useEmployeeAdminStore();
    await s.loadLinkable();
    expect(s.linkable).toEqual([]);
    expect(s.error).toBe('nope');
  });

  it('link submits the chosen account id and refreshes the list', async () => {
    api.link.mockResolvedValueOnce({ id: 'e1', hasAccount: true, userId: 'u1' });
    const s = useEmployeeAdminStore();
    expect(await s.link('e1', 'u1')).toBe(true);
    expect(api.link).toHaveBeenCalledWith('e1', 'u1');
    expect(api.list).toHaveBeenCalled(); // refreshed via run()
  });

  it('onboard posts the payload and refreshes the list', async () => {
    api.onboard.mockResolvedValueOnce({ id: 'e1', hasAccount: true, userId: 'u1' });
    const s = useEmployeeAdminStore();
    const dto = { username: 'newhire', email: 'nh@x.com', roleId: 'r1', departmentId: 'd1' };
    expect(await s.onboard('e1', dto)).toBe(true);
    expect(api.onboard).toHaveBeenCalledWith('e1', dto);
    expect(api.list).toHaveBeenCalled();
  });
});

describe('useEmployeeAdminStore — verify account', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    api.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  });

  it('verifyAccount posts and refreshes the list', async () => {
    api.verifyAccount.mockResolvedValueOnce({ id: 'e1', hasAccount: true, emailVerified: true });
    const s = useEmployeeAdminStore();
    expect(await s.verifyAccount('e1')).toBe(true);
    expect(api.verifyAccount).toHaveBeenCalledWith('e1');
    expect(api.list).toHaveBeenCalled();
  });
});

describe('verifyEmailSchema', () => {
  it('accepts a non-empty token and rejects an empty one', () => {
    expect(verifyEmailSchema.safeParse({ token: 'abc' }).success).toBe(true);
    expect(verifyEmailSchema.safeParse({ token: '' }).success).toBe(false);
  });
});

describe('onboardEmployeeSchema', () => {
  const base = { username: 'newhire', email: 'nh@example.com', roleId: '11111111-1111-1111-1111-111111111111', departmentId: '22222222-2222-2222-2222-222222222222' };

  it('accepts a valid onboarding payload (validity optional)', () => {
    expect(onboardEmployeeSchema.safeParse(base).success).toBe(true);
    expect(onboardEmployeeSchema.safeParse({ ...base, validFrom: '2026-01-01', validTo: '2026-12-31' }).success).toBe(true);
  });

  it('rejects a missing role, a bad email, and a non-uuid department', () => {
    expect(onboardEmployeeSchema.safeParse({ ...base, roleId: undefined }).success).toBe(false);
    expect(onboardEmployeeSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    expect(onboardEmployeeSchema.safeParse({ ...base, departmentId: 'not-a-uuid' }).success).toBe(false);
  });
});
