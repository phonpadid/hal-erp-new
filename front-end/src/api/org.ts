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
  // Short-lived presigned URL for the company logo, or null when none is set (list endpoint only).
  profileImageUrl?: string | null;
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
 * Upload a company's 1:1 profile image: presign → PUT bytes → register the object. Returns the
 * fresh view URL. Requires COMPANY_MANAGE (enforced server-side).
 */
export async function uploadCompanyProfileImage(companyId: string, file: File): Promise<string> {
  const { data: presign } = await api.post<{ uploadUrl: string; key: string }>(
    `/companies/${companyId}/profile-image/presign-upload`,
    { fileName: file.name, contentType: file.type },
  );
  const res = await fetch(presign.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: file.type ? { 'Content-Type': file.type } : undefined,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  const { data } = await api.post<{ profileImageUrl: string }>(`/companies/${companyId}/profile-image`, {
    filePath: presign.key,
    mimeType: file.type,
    fileSizeKb: Math.max(1, Math.round(file.size / 1024)),
  });
  return data.profileImageUrl;
}
