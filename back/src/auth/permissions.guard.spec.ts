import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PermissionsGuard } from './permissions.guard';
import { RequireAnyPermission, RequirePermissions } from './require-permissions.decorator';

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

  // A read several unrelated jobs need, that no single code describes.
  class AnyDemo {
    @RequireAnyPermission('DOC_CREATE', 'CURRENCY_VIEW', 'VENDOR_BANK_MANAGE')
    selectable() {}
  }
  const anyHandler = new AnyDemo().selectable;

  it('allows when ANY ONE of the listed codes is held', () => {
    expect(guard.canActivate(ctx(['CURRENCY_VIEW'], anyHandler))).toBe(true);
    expect(guard.canActivate(ctx(['VENDOR_BANK_MANAGE'], anyHandler))).toBe(true);
    expect(guard.canActivate(ctx(['DOC_CREATE'], anyHandler))).toBe(true);
  });

  it('denies when none of the listed codes is held', () => {
    expect(() => guard.canActivate(ctx(['MASTER_VIEW'], anyHandler))).toThrow(
      ForbiddenException,
    );
  });

  // The all-of gate is untouched by the addition: one of two is still not enough.
  class AllDemo {
    @RequirePermissions('A', 'B')
    both() {}
  }
  const allHandler = new AllDemo().both;

  it('still requires every code of an all-of gate', () => {
    expect(() => guard.canActivate(ctx(['A'], allHandler))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx(['A', 'B'], allHandler))).toBe(true);
  });

  // Both gates on one endpoint: both must pass, neither substitutes for the other.
  class BothDemo {
    @RequirePermissions('BASE')
    @RequireAnyPermission('X', 'Y')
    mixed() {}
  }
  const bothHandler = new BothDemo().mixed;

  it('requires both gates when an endpoint declares both', () => {
    expect(guard.canActivate(ctx(['BASE', 'Y'], bothHandler))).toBe(true);
    expect(() => guard.canActivate(ctx(['BASE'], bothHandler))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(['X'], bothHandler))).toThrow(ForbiddenException);
  });
});
