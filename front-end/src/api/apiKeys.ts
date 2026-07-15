import { api } from './client';
import type { IssueApiKeyInput } from '@erp/shared';

/** An API key row as listed — never carries the raw secret or its hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string | null;
}

/** The one-time issuance response — `secret` is shown once and never returned again. */
export interface IssuedApiKey {
  id: string;
  prefix: string;
  secret: string;
  name: string;
  expiresAt: string | null;
}

export interface EligibleUser {
  id: string;
  username: string;
}

/** API-key management — all API_KEY_MANAGE, active-company scoped server-side. */
export const apiKeysApi = {
  list: () => api.get<ApiKeyView[]>('/api-keys').then((r) => r.data),
  eligibleUsers: () => api.get<EligibleUser[]>('/api-keys/eligible-users').then((r) => r.data),
  issue: (dto: IssueApiKeyInput) => api.post<IssuedApiKey>('/api-keys', dto).then((r) => r.data),
  revoke: (id: string) => api.delete(`/api-keys/${id}`).then((r) => r.data),
};
