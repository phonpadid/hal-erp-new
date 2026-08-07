import { api } from './client';
import type { Paginated } from './pagination';
import type {
  BulkAssignRolesInput,
  BulkAttachPermissionsInput,
  BulkWriteResult,
  CreateServiceAccountInput,
} from '@erp/shared';

export interface RoleGrant {
  code: string;
  name: string;
  scope: string;
}
export interface AdminRole {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  permissions: RoleGrant[];
}
export interface CatalogPermission {
  code: string;
  name: string;
  module: string;
}
export interface UserAssignment {
  id: string;
  roleId: string;
  roleCode: string;
  departmentId: string;
  departmentName: string;
  isDefault: boolean;
  validFrom?: string;
  validTo?: string;
}
export interface AdminUser {
  id: string;
  username: string;
  email: string;
  status: string;
  /** True for a non-human identity that authenticates only by API key (never a person). */
  isServiceAccount: boolean;
  assignments: UserAssignment[];
}
/** One active assignment of a user in a company the requester administers (read-only). */
export interface CrossCompanyAssignment {
  id: string;
  companyId: string;
  companyCode: string;
  companyName: string;
  roleId: string;
  roleCode: string;
  departmentId: string;
  departmentName: string;
  isDefault: boolean;
  validFrom?: string;
  validTo?: string;
}

/** RBAC admin reads + writes (all RBAC_MANAGE, active-company scoped server-side). */
export const rbacApi = {
  roles: (page = 1, limit = 20) =>
    api.get<Paginated<AdminRole>>('/rbac/roles', { params: { page, limit } }).then((r) => r.data),
  permissions: (page = 1, limit = 20) =>
    api.get<Paginated<CatalogPermission>>('/rbac/permissions', { params: { page, limit } }).then((r) => r.data),
  users: (page = 1, limit = 20) =>
    api.get<Paginated<AdminUser>>('/rbac/users', { params: { page, limit } }).then((r) => r.data),
  userAssignments: (userId: string) =>
    api.get<CrossCompanyAssignment[]>(`/rbac/users/${userId}/assignments`).then((r) => r.data),
  createRole: (dto: unknown) => api.post('/rbac/roles', dto).then((r) => r.data),
  /** Create a bot identity + its first company assignment. Never carries a password. */
  createServiceAccount: (dto: CreateServiceAccountInput) =>
    api.post<AdminUser>('/rbac/service-accounts', dto).then((r) => r.data),
  attachPermission: (dto: unknown) => api.post('/rbac/role-permissions', dto).then((r) => r.data),
  /** Apply a whole grant/detach edit for one role in one request (one reload, not N). */
  attachPermissionsBulk: (dto: BulkAttachPermissionsInput) =>
    api.post<BulkWriteResult>('/rbac/role-permissions/bulk', dto).then((r) => r.data),
  detachPermission: (roleId: string, permissionCode: string) =>
    api.delete('/rbac/role-permissions', { data: { roleId, permissionCode } }).then((r) => r.data),
  assign: (dto: unknown) => api.post('/rbac/assignments', dto).then((r) => r.data),
  /** Assign several roles to one user against a shared department / default / window. */
  assignBulk: (dto: BulkAssignRolesInput) =>
    api.post<BulkWriteResult>('/rbac/assignments/bulk', dto).then((r) => r.data),
  removeAssignment: (id: string) => api.delete(`/rbac/assignments/${id}`).then((r) => r.data),
  revokeAccess: (userId: string, companyId: string) =>
    api.post('/rbac/revoke-access', { userId, companyId }).then((r) => r.data),
};
