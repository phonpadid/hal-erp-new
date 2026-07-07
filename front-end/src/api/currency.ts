import { api } from './client';
import type { Paginated } from './pagination';

export interface Currency {
  code: string;
  name: string;
  symbol?: string;
  decimalPlaces: number;
  isActive: boolean;
}
export interface ExchangeRate {
  id: string;
  fromCurrency?: { code?: string } | null;
  toCurrency?: { code?: string } | null;
  rate: string;
  rateDate: string;
  rateType: string;
  source?: string | null;
  company?: { code?: string } | null;
}
export interface RateFilter {
  from?: string;
  to?: string;
  rateType?: string;
}

/** Active currencies for the document-creation picker (DOC_CREATE read; no admin fields). */
export type SelectableCurrency = Omit<Currency, 'isActive'>;

export const currencyApi = {
  currencies: {
    list: (page = 1, limit = 20) =>
      api.get<Paginated<Currency>>('/currencies', { params: { page, limit } }).then((r) => r.data),
    // Picker for document creation — gated by DOC_CREATE (not CURRENCY_VIEW), active-only.
    selectable: () =>
      api.get<SelectableCurrency[]>('/currencies/selectable').then((r) => r.data),
    create: (dto: unknown) => api.post('/currencies', dto).then((r) => r.data),
    update: (code: string, dto: unknown) => api.patch(`/currencies/${code}`, dto).then((r) => r.data),
  },
  rates: {
    list: (filter: RateFilter = {}, page = 1, limit = 20) =>
      api.get<Paginated<ExchangeRate>>('/exchange-rates', { params: { ...filter, page, limit } }).then((r) => r.data),
    create: (dto: unknown) => api.post('/exchange-rates', dto).then((r) => r.data),
    // Resolve the effective rate for a pair as of a date (company override → group → inverse).
    resolve: (from: string, to: string, asOf: string) =>
      api
        .get<ResolvedRate>('/exchange-rates/resolve', { params: { from, to, asOf } })
        .then((r) => r.data),
  },
};

export interface ResolvedRate {
  rate: string;
  source: string;
  asOf: string;
  rateType: string;
}
