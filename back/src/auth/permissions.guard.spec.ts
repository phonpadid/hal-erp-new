import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

// Builds a fake ExecutionContext whose request.user carries permission codes
// (AuthUser.permissionCodes, derived from the token's scoped grants).
function ctx(permissionCodes: string[], handler: object) {
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
  } as any;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  class Demo {
    @RequirePermissions('DOC_PR_APPROVE')
    approve() {}
  }
  const handler = new Demo().approve;

  it('allows when the required permission CODE is present', () => {
    expect(guard.canActivate(ctx(['DOC_PR_APPROVE'], handler))).toBe(true);
  });

  it('denies when the code is missing (role names are irrelevant)', () => {
    // User has a role-shaped string but not the code → still denied.
    expect(() => guard.canActivate(ctx(['Manager'], handler))).toThrow(
      ForbiddenException,
    );
  });

  it('allows endpoints with no required permission', () => {
    expect(guard.canActivate(ctx([], () => {}))).toBe(true);
  });
});
