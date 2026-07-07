import { api } from './client';
import type { Paginated } from './pagination';
import type { LinkableAccount } from '@erp/shared';

export type { LinkableAccount };

/** An employee registry record. `salary` is present only for EMP_SALARY_VIEW holders. */
export interface Employee {
  id: string;
  empCode: string;
  fullName: string;
  departmentId: string;
  departmentName: string;
  position?: string;
  jobLevel?: string;
  hireDate?: string;
  status: string;
  userId?: string;
  hasAccount: boolean;
  emailVerified: boolean;
  salary?: string;
}

/** Employee registry — all EMPLOYEE_MANAGE, active-company scoped server-side. */
export const employeesApi = {
  list: (page = 1, limit = 20) =>
    api.get<Paginated<Employee>>('/employees', { params: { page, limit } }).then((r) => r.data),
  get: (id: string) => api.get<Employee>(`/employees/${id}`).then((r) => r.data),
  create: (dto: unknown) => api.post<Employee>('/employees', dto).then((r) => r.data),
  update: (id: string, dto: unknown) => api.patch<Employee>(`/employees/${id}`, dto).then((r) => r.data),
  link: (id: string, userId: string) =>
    api.post<Employee>(`/employees/${id}/link`, { userId }).then((r) => r.data),
  linkableAccounts: (search?: string) =>
    api
      .get<LinkableAccount[]>('/employees/linkable-accounts', { params: search ? { search } : undefined })
      .then((r) => r.data),
  createAccount: (id: string, dto: { username: string; email: string }) =>
    api.post<Employee>(`/employees/${id}/create-account`, dto).then((r) => r.data),
  onboard: (
    id: string,
    dto: {
      username: string;
      email: string;
      roleId: string;
      departmentId: string;
      validFrom?: string;
      validTo?: string;
    },
  ) => api.post<Employee>(`/employees/${id}/onboard`, dto).then((r) => r.data),
  verifyAccount: (id: string) =>
    api.post<Employee>(`/employees/${id}/verify-account`).then((r) => r.data),
  unlink: (id: string) => api.post<Employee>(`/employees/${id}/unlink`).then((r) => r.data),
  resign: (id: string) =>
    api.post<{ status: string; expired: number }>(`/employees/${id}/resign`).then((r) => r.data),
};
