import { api } from './client';
import type { Paginated } from './pagination';

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface Account {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  parent?: { id: string; code?: string } | null;
  isPostable: boolean;
  isActive: boolean;
}

/** Active, postable accounts for the budget-form GL picker (no admin fields). */
export interface SelectableAccount {
  id: string;
  code: string;
  name: string;
}

export const accountsApi = {
  list: (page = 1, limit = 100, includeInactive = false, search?: string) =>
    api
      .get<Paginated<Account>>('/accounts', { params: { page, limit, includeInactive, search } })
      .then((r) => r.data),
  selectable: () => api.get<SelectableAccount[]>('/accounts/selectable').then((r) => r.data),
  create: (dto: unknown) => api.post('/accounts', dto).then((r) => r.data),
  update: (id: string, dto: unknown) => api.patch(`/accounts/${id}`, dto).then((r) => r.data),
  deactivate: (id: string) => api.delete(`/accounts/${id}`).then((r) => r.data),
};
