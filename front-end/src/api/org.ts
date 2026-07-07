import { api } from './client';
import type { Paginated } from './pagination';

export interface Company {
  id: string;
  code: string;
  nameTh: string;
  nameEn?: string;
  taxId: string;
  branchCode: string;
  baseCurrency?: { code?: string } | null;
  isActive: boolean;
}
export interface Department {
  id: string;
  deptCode: string;
  name: string;
  parentDept?: { id?: string } | null;
  costCenter?: string;
  isActive: boolean;
}
export interface FiscalYear {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
  status: string;
}
export interface Holiday {
  id: string;
  holidayDate: string;
  name: string;
}
export interface CurrencyRef {
  code: string;
  name: string;
}

export const orgApi = {
  companies: {
    list: (page = 1, limit = 20) =>
      api.get<Paginated<Company>>('/companies', { params: { page, limit } }).then((r) => r.data),
    create: (dto: unknown) => api.post('/companies', dto).then((r) => r.data),
    update: (id: string, dto: unknown) => api.patch(`/companies/${id}`, dto).then((r) => r.data),
  },
  departments: {
    list: (page = 1, limit = 20) =>
      api.get<Paginated<Department>>('/departments', { params: { page, limit } }).then((r) => r.data),
    create: (dto: unknown) => api.post('/departments', dto).then((r) => r.data),
    update: (id: string, dto: unknown) => api.patch(`/departments/${id}`, dto).then((r) => r.data),
  },
  fiscalYears: {
    list: (page = 1, limit = 20) =>
      api.get<Paginated<FiscalYear>>('/fiscal-years', { params: { page, limit } }).then((r) => r.data),
    create: (dto: unknown) => api.post('/fiscal-years', dto).then((r) => r.data),
    update: (id: string, dto: unknown) => api.patch(`/fiscal-years/${id}`, dto).then((r) => r.data),
    close: (id: string) => api.post(`/fiscal-years/${id}/close`, {}).then((r) => r.data),
  },
  holidays: {
    list: (page = 1, limit = 20) =>
      api.get<Paginated<Holiday>>('/holidays', { params: { page, limit } }).then((r) => r.data),
    create: (dto: unknown) => api.post('/holidays', dto).then((r) => r.data),
    remove: (id: string) => api.delete(`/holidays/${id}`).then((r) => r.data),
  },
  // `/currencies` is paginated ({ items, total, ... }); the base-currency <Select> needs the array.
  currencies: () =>
    api.get<Paginated<CurrencyRef>>('/currencies', { params: { page: 1, limit: 100 } }).then((r) => r.data.items),
};
