import type { Scope } from '../common/enums';

/** A single resolved permission grant: a code plus the data scope it applies at. */
export interface Grant {
  code: string; // permission CODE (e.g. DOC_PR_APPROVE), never a role name
  scope: Scope; // OWN / DEPARTMENT / COMPANY / GROUP
}

/**
 * Company-context JWT payload (rbac: Company Context Token). Bound to the selected
 * company; carries the user's department and the permissions resolved for THAT
 * company, each with its scope.
 */
export interface JwtPayload {
  sub: string; // app_user.id
  companyId: string; // active company context
  departmentId: string; // user's HOME department in the active company (where a draft is raised)
  /**
   * Every department the user holds an active assignment in for the active company; always
   * contains `departmentId`. DEPARTMENT-scoped reads filter on this set. Absent on tokens issued
   * before the claim existed — readers fall back to `[departmentId]`.
   */
  departmentIds?: string[];
  grants: Grant[]; // resolved permission codes + scopes for the active company
}
