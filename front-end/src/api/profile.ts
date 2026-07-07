import { api } from './client';
import type { ChangePasswordInput } from '@erp/shared';

/** The signed-in user's own profile (identity + optional linked employee + active-company access). */
export interface OwnProfile {
  username: string;
  email: string;
  emailVerifiedAt: string | null;
  status: string;
  employee: { fullName: string; position: string | null; departmentName: string } | null;
  // Role(s) held and resolved permission grants for the active company.
  roles: string[];
  permissions: { code: string; scope: string }[];
}

/** Own-account reads/writes — the server resolves the user from the JWT (no id in the path). */
export const profileApi = {
  get: () => api.get<OwnProfile>('/auth/profile').then((r) => r.data),
  changePassword: (payload: ChangePasswordInput) =>
    api.post('/auth/change-password', payload).then((r) => r.data),
};
