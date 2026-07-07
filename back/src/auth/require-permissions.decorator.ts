import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Guard an endpoint by permission CODE(s) — e.g. @RequirePermissions('DOC_PR_APPROVE').
 * Authorization is always on codes, never role names (invariant 6).
 */
export const RequirePermissions = (...codes: string[]) =>
  SetMetadata(PERMISSIONS_KEY, codes);
