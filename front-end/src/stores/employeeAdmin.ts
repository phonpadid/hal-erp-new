import { defineStore } from 'pinia';
import { employeesApi } from '../api/employees';
import type { Employee, EmployeeListFilters, LinkableAccount } from '../api/employees';
import { messageOf } from '../utils/apiError';

interface EmployeeAdminState {
  employees: Employee[];
  total: number;
  page: number;
  limit: number;
  /** Server-side search + filters; the store owns them so every reload path keeps them. */
  filters: EmployeeListFilters;
  loading: boolean;
  saving: boolean;
  error: string;
  linkable: LinkableAccount[];
  linkableLoading: boolean;
}

/**
 * Employee registry admin state for the active company (reloads on company switch — the
 * switch does a full page reload, so filters start empty for the new company).
 *
 * Search and filters live here rather than in the view because `run()` reloads the list after
 * every mutation (edit, link, verify, unlink, resign). With the filter state in the view, each
 * of those would silently drop it and drop the user back to the unfiltered list.
 */
export const useEmployeeAdminStore = defineStore('employeeAdmin', {
  state: (): EmployeeAdminState => ({
    employees: [],
    total: 0,
    page: 1,
    limit: 20,
    filters: {},
    loading: false,
    saving: false,
    error: '',
    linkable: [],
    linkableLoading: false,
  }),
  actions: {
    /** Load login accounts not yet linked to any employee, for the link picker. */
    async loadLinkable(search?: string) {
      this.linkableLoading = true;
      try {
        this.linkable = await employeesApi.linkableAccounts(search);
      } catch (e) {
        this.error = messageOf(e);
        this.linkable = [];
      } finally {
        this.linkableLoading = false;
      }
    },

    async load(page?: number, limit?: number) {
      this.loading = true;
      this.error = '';
      try {
        const res = await employeesApi.list(page ?? this.page, limit ?? this.limit, this.filters);
        this.employees = res.items;
        this.total = res.total;
        this.page = res.page;
        this.limit = res.limit;
      } catch (e) {
        this.error = messageOf(e);
      } finally {
        this.loading = false;
      }
    },

    /**
     * Apply new search/filters and reload from page 1 — the result set changes size, so
     * staying on page 4 of a set that now has one page would show an empty table.
     */
    async applyFilters(filters: EmployeeListFilters) {
      this.filters = filters;
      await this.load(1, this.limit);
    },

    /** Clear every filter and the search term, and reload the full list from page 1. */
    async clearFilters() {
      this.filters = {};
      await this.load(1, this.limit);
    },

    async run(fn: () => Promise<unknown>): Promise<boolean> {
      this.error = '';
      this.saving = true;
      try {
        await fn();
        await this.load();
        return true;
      } catch (e) {
        this.error = messageOf(e);
        return false;
      } finally {
        this.saving = false;
      }
    },

    create(dto: unknown) {
      return this.run(() => employeesApi.create(dto));
    },
    update(id: string, dto: unknown) {
      return this.run(() => employeesApi.update(id, dto));
    },
    link(id: string, userId: string) {
      return this.run(() => employeesApi.link(id, userId));
    },
    createAccount(id: string, dto: { username: string; email: string }) {
      return this.run(() => employeesApi.createAccount(id, dto));
    },
    onboard(
      id: string,
      dto: {
        username: string;
        email: string;
        roleId: string;
        departmentId: string;
        validFrom?: string;
        validTo?: string;
      },
    ) {
      return this.run(() => employeesApi.onboard(id, dto));
    },
    verifyAccount(id: string) {
      return this.run(() => employeesApi.verifyAccount(id));
    },
    unlink(id: string) {
      return this.run(() => employeesApi.unlink(id));
    },
    resign(id: string) {
      return this.run(() => employeesApi.resign(id));
    },
  },
});
