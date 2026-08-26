import { api } from './client';
import type { Paginated } from './pagination';

export interface Delegation {
  id: string;
  delegatorId: string;
  delegatorName: string;
  delegateId: string;
  delegateName: string;
  documentTypeId?: string;
  documentTypeCode?: string;
  amountLimit?: string;
  startDate: string;
  endDate: string;
  status: string;
  reason?: string;
}

export const approvalConfigApi = {
  delegations: {
    list: (page = 1, limit = 20, search?: string) =>
      api
        .get<Paginated<Delegation>>('/workflows/delegations', { params: { page, limit, search } })
        .then((r) => r.data),
    create: (dto: unknown) => api.post('/workflows/delegations', dto).then((r) => r.data),
    cancel: (id: string) => api.post(`/workflows/delegations/${id}/cancel`, {}).then((r) => r.data),
  },
  // Pickers (admin holds RBAC_MANAGE / DOC_CONFIG_MANAGE). `/rbac/users` is paged; the
  // store requests limit=100 so the Select options aren't truncated.
  users: (page = 1, limit = 100) =>
    api
      .get<Paginated<{ id: string; username: string }>>('/rbac/users', { params: { page, limit } })
      .then((r) => r.data.items),
  // `/document-config/document-types` is paged; request limit=100 and unwrap `.items` so
  // the Select receives an array (not the {items,total,…} envelope) and isn't truncated.
  documentTypes: (page = 1, limit = 100) =>
    api
      .get<Paginated<{ id: string; code: string }>>('/document-config/document-types', { params: { page, limit } })
      .then((r) => r.data.items),
};
