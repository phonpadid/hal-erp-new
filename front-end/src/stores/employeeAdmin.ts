import { defineStore } from 'pinia';
import { employeesApi } from '../api/employees';
import type { Employee, LinkableAccount } from '../api/employees';
import { messageOf } from '../utils/apiError';

interface EmployeeAdminState {
  employees: Employee[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  saving: boolean;
  error: string;
  linkable: LinkableAccount[];
  linkableLoading: boolean;
}

/** Employee registry admin state for the active company (reloads on company switch). */
export const useEmployeeAdminStore = defineStore('employeeAdmin', {
  state: (): EmployeeAdminState => ({
    employees: [],
    total: 0,
    page: 1,
    limit: 20,
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
        const res = await employeesApi.list(page ?? this.page, limit ?? this.limit);
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
