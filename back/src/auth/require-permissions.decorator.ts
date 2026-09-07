import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';
export const ANY_PERMISSIONS_KEY = 'required_any_permissions';

/**
 * Guard an endpoint by permission CODE(s) — e.g. @RequirePermissions('DOC_PR_APPROVE').
 * ALL of the codes must be held. Authorization is always on codes, never role names (invariant 6).
 */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);

/**
 * Guard an endpoint by ANY ONE of several permission CODEs.
 *
 * For a read that several unrelated jobs legitimately need and no single code describes — the
 * selectable-currencies picker is read by a document creator, a currency administrator and whoever
 * records a vendor's payee account. The alternative is granting one of them a code that means
 * something else entirely, which is how `DOC_CREATE` starts meaning "may see a list".
 *
 * Composes with @RequirePermissions: where an endpoint carries both, both gates must pass.
 */
export const RequireAnyPermission = (...codes: string[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, codes);
