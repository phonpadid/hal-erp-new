import { api } from './client';
import type { Paginated } from './pagination';

export interface Company {
  id: string;
  code: string;
  nameTh: string;
  nameEn?: string;
  taxId?: string | null;
  branchCode: string;
  baseCurrency?: { code?: string } | null;
  isActive: boolean;
  // Letterhead contact block, printed on the document PDF footer. Returned by GET /companies/:id.
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  // Short-lived presigned URL for the company logo, or null when none is set (list endpoint only).
  profileImageUrl?: string | null;
}
export interface Department {
  id: string;
  deptCode: string;
  name: string;
  // The abbreviation stamped in a paper document number; null means the code is used.
  shortName?: string | null;
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
    get: (id: string) => api.get<Company>(`/companies/${id}`).then((r) => r.data),
    create: (dto: unknown) => api.post<Company>('/companies', dto).then((r) => r.data),
    update: (id: string, dto: unknown) => api.patch(`/companies/${id}`, dto).then((r) => r.data),
    profileImage: (id: string) =>
      api.get<{ profileImageUrl: string | null }>(`/companies/${id}/profile-image`).then((r) => r.data),
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

/**
 * Upload a company's 1:1 profile image (logo) straight to the API (multipart); the backend
 * validates it, writes it to storage, and returns the fresh view URL. Requires COMPANY_MANAGE
 * (enforced server-side).
 */
export async function uploadCompanyProfileImage(companyId: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file, file.name);
  const { data } = await api.post<{ profileImageUrl: string }>(
    `/companies/${companyId}/profile-image/upload`,
    form,
  );
  return data.profileImageUrl;
}
