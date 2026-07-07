import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assignRoleSchema, attachPermissionSchema, createRoleSchema } from '@erp/shared';
import { useRbacAdminStore } from './rbacAdmin';
import { rbacApi } from '../api/rbac';

vi.mock('../api/rbac', () => ({
  rbacApi: {
    roles: vi.fn(), permissions: vi.fn(), users: vi.fn(),
    createRole: vi.fn(), attachPermission: vi.fn(), detachPermission: vi.fn(),
    assign: vi.fn(), removeAssignment: vi.fn(), revokeAccess: vi.fn(),
  },
}));

const m = rbacApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const UUID = '11111111-1111-1111-1111-111111111111';

describe('rbac shared schemas', () => {
  it('accepts valid payloads', () => {
    expect(createRoleSchema.safeParse({ code: 'OPS', name: 'Ops' }).success).toBe(true);
    expect(attachPermissionSchema.safeParse({ roleId: UUID, permissionCode: 'DOC_VIEW', scope: 'COMPANY' }).success).toBe(true);
    expect(assignRoleSchema.safeParse({ userId: UUID, roleId: UUID, departmentId: UUID }).success).toBe(true);
  });

  it('rejects a bad scope and missing required fields', () => {
    expect(attachPermissionSchema.safeParse({ roleId: UUID, permissionCode: 'X', scope: 'BOGUS' }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'no code' }).success).toBe(false);
    expect(assignRoleSchema.safeParse({ userId: UUID, roleId: UUID }).success).toBe(false);
  });
});

describe('useRbacAdminStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    const empty = { items: [], total: 0, page: 1, limit: 20 };
    m.roles.mockResolvedValue(empty); m.permissions.mockResolvedValue(empty); m.users.mockResolvedValue(empty);
  });

  it('loadAll populates roles, permissions and users', async () => {
    m.roles.mockResolvedValueOnce({ items: [{ id: 'r1', code: 'ADMIN', permissions: [] }], total: 1, page: 1, limit: 100 });
    m.permissions.mockResolvedValueOnce({ items: [{ code: 'RBAC_MANAGE' }], total: 1, page: 1, limit: 100 });
    m.users.mockResolvedValueOnce({ items: [{ id: 'u1', username: 'admin', assignments: [] }], total: 1, page: 1, limit: 20 });
    const s = useRbacAdminStore();
    await s.loadAll();
    expect(s.roles).toHaveLength(1);
    expect(s.permissions).toHaveLength(1);
    expect(s.users).toHaveLength(1);
  });

  it('mutations call the endpoint and refresh', async () => {
    m.attachPermission.mockResolvedValueOnce(undefined);
    const s = useRbacAdminStore();
    const ok = await s.attachPermission({ roleId: 'r1', permissionCode: 'DOC_VIEW', scope: 'COMPANY' });
    expect(ok).toBe(true);
    expect(m.attachPermission).toHaveBeenCalled();
    expect(m.roles).toHaveBeenCalled(); // refreshed via loadAll
  });

  it('captures a server error and returns false', async () => {
    m.detachPermission.mockRejectedValueOnce({ response: { data: { message: 'denied' } } });
    const s = useRbacAdminStore();
    const ok = await s.detachPermission('r1', 'DOC_VIEW');
    expect(ok).toBe(false);
    expect(s.error).toBe('denied');
  });
});
