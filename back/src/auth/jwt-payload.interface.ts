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
  departmentId: string; // user's department in the active company
  grants: Grant[]; // resolved permission codes + scopes for the active company
}
