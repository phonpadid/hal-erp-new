import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './auth';
import { api } from '../api/client';

vi.mock('../api/client', () => ({
  api: { post: vi.fn(), get: vi.fn() },
}));

const mockApi = api as unknown as { post: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };

const ME = {
  userId: 'u1',
  companyId: 'A',
  departmentId: 'd1',
  grants: [{ code: 'DOC_VIEW', scope: 'COMPANY' }, { code: 'DOC_CREATE', scope: 'OWN' }],
};

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('logs in with a default company: stores token, loads context, returns home', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { user: { id: 'u1' }, companies: [{ id: 'A', code: 'A', nameTh: 'A', isDefault: true }], accessToken: 'tok' } });
    mockApi.get.mockResolvedValueOnce({ data: ME });

    const auth = useAuthStore();
    const next = await auth.login('def', 'secret');

    expect(next).toBe('home');
    expect(auth.token).toBe('tok');
    expect(localStorage.getItem('erp_token')).toBe('tok');
    expect(auth.activeCompanyId).toBe('A');
    expect(auth.permissions).toEqual(['DOC_VIEW', 'DOC_CREATE']);
    expect(auth.can('DOC_VIEW')).toBe(true);
    expect(auth.can('BUDGET_MANAGE')).toBe(false);
  });

  it('logs in without a default: lists companies, no token, returns select-company', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { user: { id: 'u1' }, companies: [{ id: 'A' }, { id: 'B' }], accessToken: null } });

    const auth = useAuthStore();
    const next = await auth.login('nodef', 'secret');

    expect(next).toBe('select-company');
    expect(auth.token).toBeNull();
    expect(auth.companies).toHaveLength(2);
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('switches company: re-issues token and refreshes permissions', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { accessToken: 'tokB', companyId: 'B' } });
    mockApi.get.mockResolvedValueOnce({ data: { ...ME, companyId: 'B', grants: [{ code: 'BUDGET_VIEW', scope: 'COMPANY' }] } });

    const auth = useAuthStore();
    await auth.selectCompany('B');

    expect(auth.token).toBe('tokB');
    expect(auth.activeCompanyId).toBe('B');
    expect(auth.permissions).toEqual(['BUDGET_VIEW']);
  });

  it('logout clears the session and storage', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { companies: [], accessToken: 'tok' } });
    mockApi.get.mockResolvedValueOnce({ data: ME });
    const auth = useAuthStore();
    await auth.login('def', 'secret');

    auth.logout();

    expect(auth.token).toBeNull();
    expect(auth.permissions).toEqual([]);
    expect(auth.isAuthenticated).toBe(false);
    expect(localStorage.getItem('erp_token')).toBeNull();
  });
});
