import { api } from './client';
import type { Paginated } from './pagination';
import type { ItemInput, VendorInput } from '@erp/shared';

export interface Vendor extends VendorInput {
  id: string;
  isActive?: boolean;
  // `paymentTermDays` on the /enabled read is the per-company effective value (override ?? group).
}
export interface Item extends ItemInput {
  id: string;
  isActive?: boolean;
  // `defaultGlAccount` is present only on the /enabled read — the item's GL for the active company.
  defaultGlAccount?: string;
}

function crud<T>(base: string) {
  return {
    list: (page = 1, limit = 20) =>
      api.get<Paginated<T>>(base, { params: { page, limit } }).then((r) => r.data),
    enabled: () => api.get<T[]>(`${base}/enabled`).then((r) => r.data),
    create: (dto: unknown) => api.post(base, dto).then((r) => r.data),
    update: (id: string, dto: unknown) => api.patch(`${base}/${id}`, dto).then((r) => r.data),
    // Enable may carry per-company options (item GL / vendor payment terms).
    enable: (id: string, body: Record<string, unknown> = {}) =>
      api.post(`${base}/${id}/enable`, body).then((r) => r.data),
    disable: (id: string) => api.post(`${base}/${id}/disable`, {}).then((r) => r.data),
    remove: (id: string) => api.delete(`${base}/${id}`).then((r) => r.data),
  };
}

export const masterDataApi = {
  vendors: crud<Vendor>('/vendors'),
  items: crud<Item>('/items'),
};
