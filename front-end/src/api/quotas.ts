import { api } from './client';
import type { Paginated } from './pagination';

export interface QuotaSummary {
  id: string;
  quotaType: string;
  unit: string;
  limitValue: string;
  resetCycle: string;
  carryForward?: boolean;
  department?: { name?: string } | null;
}

export interface QuotaEntitlementRow {
  employeeId: string;
  employeeName: string;
  year: number;
  entitled: string;
  used: string;
  remaining: string;
}

export interface QuotaBreakdown {
  quota: { id: string; quotaType: string; unit: string; limitValue: string; resetCycle: string; departmentName: string | null };
  pool: { limit: string; used: string; remaining: string };
  entitlements: QuotaEntitlementRow[];
}

export interface QuotaUsageEntry {
  id: string;
  usageType: string;
  qtyUsed: string;
  employeeName: string | null;
  documentId: string | null;
  documentNo: string | null;
  createdAt: string | null;
}

/** A per-employee entitlement row with derived entitled / used / remaining. */
export interface EntitlementRow {
  employeeId: string;
  employeeName: string;
  year: number;
  entitledValue: string;
  carriedOver: string;
  adjusted: string;
  entitled: string;
  used: string;
  remaining: string;
}

/** Read-only quota views (list, breakdown, usage ledger). */
export const quotasApi = {
  list: (page = 1, limit = 20) =>
    api.get<Paginated<QuotaSummary>>('/quotas', { params: { page, limit } }).then((r) => r.data),
  get: (id: string) => api.get(`/quotas/${id}`).then((r) => r.data),
  breakdown: (id: string) => api.get<QuotaBreakdown>(`/quotas/${id}/breakdown`).then((r) => r.data),
  usage: (id: string, page = 1, limit = 20) =>
    api
      .get<Paginated<QuotaUsageEntry>>(`/quotas/${id}/usage`, { params: { page, limit } })
      .then((r) => r.data),
};

/** Quota administration (QUOTA_MANAGE for writes; server is authoritative + company-scoped). */
export const quotaAdminApi = {
  create: (dto: unknown) => api.post('/quotas', dto).then((r) => r.data),
  update: (id: string, dto: unknown) => api.patch(`/quotas/${id}`, dto).then((r) => r.data),
  deactivate: (id: string) => api.delete(`/quotas/${id}`).then((r) => r.data),
  entitlements: (quotaId: string, year?: number) =>
    api
      .get<EntitlementRow[]>('/quota-entitlements', { params: { quotaId, year } })
      .then((r) => r.data),
  upsertEntitlement: (dto: unknown) => api.post('/quota-entitlements', dto).then((r) => r.data),
  adjustEntitlement: (dto: unknown) => api.post('/quota-entitlements/adjust', dto).then((r) => r.data),
  carryForward: (dto: unknown) =>
    api.post<EntitlementRow[]>('/quota-entitlements/carry-forward', dto).then((r) => r.data),
};
