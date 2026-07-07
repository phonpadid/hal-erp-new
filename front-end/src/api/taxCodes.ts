import { api } from './client';
import type { Paginated } from './pagination';

export type TaxKind = 'VAT' | 'WHT';

export interface TaxCode {
  id: string;
  code: string;
  name: string;
  kind: TaxKind;
  rate: string;
  isActive: boolean;
}

export interface SelectableVat {
  id: string;
  code: string;
  name: string;
  rate: string;
}

export interface VatSummaryRow {
  period: string;
  vat: string;
  wht: string;
}

export const taxCodesApi = {
  list: (page = 1, limit = 100, includeInactive = false) =>
    api.get<Paginated<TaxCode>>('/tax-codes', { params: { page, limit, includeInactive } }).then((r) => r.data),
  selectableVat: () => api.get<SelectableVat[]>('/tax-codes/selectable-vat').then((r) => r.data),
  selectableWht: () => api.get<SelectableVat[]>('/tax-codes/selectable-wht').then((r) => r.data),
  vatSummary: () => api.get<VatSummaryRow[]>('/tax-codes/vat-summary').then((r) => r.data),
  create: (dto: unknown) => api.post('/tax-codes', dto).then((r) => r.data),
  update: (id: string, dto: unknown) => api.patch(`/tax-codes/${id}`, dto).then((r) => r.data),
  deactivate: (id: string) => api.delete(`/tax-codes/${id}`).then((r) => r.data),
};
