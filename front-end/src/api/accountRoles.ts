import { api } from './client';

/**
 * Which account plays each system role for the active company.
 *
 * The list comes from the server, which derives it from the roles the GL actually resolves — not
 * from a copy kept here. A role the ledger asks for and this screen never shows is a posting that
 * fails with nowhere to fix it, which is the state this screen exists to end.
 */
export interface AccountRoleMapping {
  role: string;
  /** What the role is for, in words. `GRNI` names nothing on its own. */
  purpose: string;
  /** Whether this company's own configuration will ask the GL to resolve it. */
  required: boolean;
  account?: { id: string; code: string; name: string; isActive: boolean };
}

export const accountRolesApi = {
  list: () => api.get<AccountRoleMapping[]>('/account-roles').then((r) => r.data),
  /** Point one role at one account, replacing wherever it pointed before. */
  set: (role: string, accountId: string) =>
    api.put<AccountRoleMapping>(`/account-roles/${role}`, { accountId }).then((r) => r.data),
};
