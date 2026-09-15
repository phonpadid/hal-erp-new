import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { AccountController } from './account.controller';

/**
 * The selectable-accounts read serves two pickers held by two different people: the budget form
 * (a COA_VIEW holder) and the mid-approval line re-code (a DOC_LINE_RECODE holder, who at HAL is
 * accounting staff with no chart-of-accounts code at all). Gated on COA_VIEW alone the re-code
 * dialog opened on "No available options" — found on the first real try, not by a test.
 */
describe('GET /accounts/selectable permission gate', () => {
  const guard = new PermissionsGuard(new Reflector());
  const handler = AccountController.prototype.listSelectable;
  const ctx = (permissionCodes: string[]) =>
    ({
      getHandler: () => handler,
      getClass: () => AccountController,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
    }) as any;

  it('allows a chart reader holding COA_VIEW', () => {
    expect(guard.canActivate(ctx(['COA_VIEW']))).toBe(true);
  });

  it('allows an accountant holding DOC_LINE_RECODE and no chart code', () => {
    expect(guard.canActivate(ctx(['DOC_LINE_RECODE', 'DOC_APPROVE']))).toBe(true);
  });

  it('denies a user holding neither', () => {
    expect(() => guard.canActivate(ctx([]))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx(['DOC_APPROVE', 'GL_VIEW']))).toThrow(ForbiddenException);
  });
});
