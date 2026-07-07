import { defineStore } from 'pinia';
import { rbacApi } from '../api/rbac';
import type { AdminRole, AdminUser, CatalogPermission } from '../api/rbac';
import type { Paginated } from '../api/pagination';
import { messageOf } from '../utils/apiError';

interface RbacAdminState {
  roles: AdminRole[];
  permissions: CatalogPermission[];
  users: AdminUser[];
  // Paged state for the users table; roles/permissions are loaded in full (every page,
  // see loadAllPages) because they also feed Select options (assign-role picker,
  // grant-permission picker) and the per-role grant manager — capping them silently
  // truncates the catalog.
  usersTotal: number;
  usersPage: number;
  usersLimit: number;
  loading: boolean;
  error: string;
}

/**
 * Page a list endpoint to exhaustion: fetch page 1, then keep fetching subsequent pages
 * while fewer items than the server's `total` have been collected, concatenating them.
 * A high per-request limit keeps the number of round-trips small.
 */
async function loadAllPages<T>(fetchPage: (page: number, limit: number) => Promise<Paginated<T>>): Promise<T[]> {
  const limit = 200;
  const first = await fetchPage(1, limit);
  let items = first.items;
  let page = 1;
  while (items.length < first.total) {
    page += 1;
    const next = await fetchPage(page, limit);
    if (!next.items.length) break;
    items = items.concat(next.items);
  }
  return items;
}


export const useRbacAdminStore = defineStore('rbacAdmin', {
  state: (): RbacAdminState => ({
    roles: [],
    permissions: [],
    users: [],
    usersTotal: 0,
    usersPage: 1,
    usersLimit: 20,
    loading: false,
    error: '',
  }),
  actions: {
    async loadUsers(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await rbacApi.users(page ?? this.usersPage, limit ?? this.usersLimit);
        this.users = res.items;
        this.usersTotal = res.total;
        this.usersPage = res.page;
        this.usersLimit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async loadAll() {
      this.loading = true;
      this.error = '';
      try {
        // roles + permissions feed Select dropdowns and the per-role grant manager, so
        // load every page (never a single capped page) to avoid silently truncating the
        // catalog; users is the paged table.
        const [roles, permissions, users] = await Promise.all([
          loadAllPages((page, limit) => rbacApi.roles(page, limit)),
          loadAllPages((page, limit) => rbacApi.permissions(page, limit)),
          rbacApi.users(this.usersPage, this.usersLimit),
        ]);
        this.roles = roles;
        this.permissions = permissions;
        this.users = users.items;
        this.usersTotal = users.total;
        this.usersPage = users.page;
        this.usersLimit = users.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    async run(fn: () => Promise<unknown>): Promise<boolean> {
      this.error = '';
      try {
        await fn();
        await this.loadAll();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      }
    },

    createRole(dto: unknown) {
      return this.run(() => rbacApi.createRole(dto));
    },
    attachPermission(dto: unknown) {
      return this.run(() => rbacApi.attachPermission(dto));
    },
    detachPermission(roleId: string, code: string) {
      return this.run(() => rbacApi.detachPermission(roleId, code));
    },
    assign(dto: unknown) {
      return this.run(() => rbacApi.assign(dto));
    },
    removeAssignment(id: string) {
      return this.run(() => rbacApi.removeAssignment(id));
    },
    revokeAccess(userId: string, companyId: string) {
      return this.run(() => rbacApi.revokeAccess(userId, companyId));
    },
  },
});
