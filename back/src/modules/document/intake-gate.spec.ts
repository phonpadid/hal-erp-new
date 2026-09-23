import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { ApiKeyDenyGuard } from '../../auth/api-key-deny.guard';
import { DocumentIntakeController } from './document-intake.controller';
import { DocumentPermissions as P } from './permissions';

/**
 * Which codes reach the intake endpoints, read off the routes themselves.
 *
 * The service's own spec proves the RULE (a code alone does not reach an unreached document); this
 * file proves the GATE is actually mounted, which is the half a unit test of the guard cannot see.
 * Receiving and reversing must not share a code: everyone in finance receives, one person fixes a
 * mistake, and a single code would make those the same authority.
 */
function ctx(permissionCodes: string[], handler: object) {
  return {
    getHandler: () => handler,
    getClass: () => DocumentIntakeController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
  } as never;
}

describe('the intake endpoints are gated', () => {
  const guard = new PermissionsGuard(new Reflector());
  const proto = DocumentIntakeController.prototype as unknown as Record<string, object>;

  it('refuses receiving without DOC_INTAKE_RECEIVE', () => {
    expect(() => guard.canActivate(ctx([P.DOC_VIEW, P.DOC_APPROVE], proto.receive))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx([P.DOC_INTAKE_RECEIVE], proto.receive))).toBe(true);
  });

  it('refuses reversing to someone who may only receive', () => {
    expect(() => guard.canActivate(ctx([P.DOC_INTAKE_RECEIVE], proto.reverse))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx([P.DOC_INTAKE_REVERSE], proto.reverse))).toBe(true);
  });

  // The goods-receipt code means a different receipt entirely. If these ever converge, a company
  // that let a storekeeper book deliveries would have quietly given them finance's intake book.
  it('does not accept the goods-receipt code for either', () => {
    expect(() => guard.canActivate(ctx([P.DOC_RECEIVE], proto.receive))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx([P.DOC_RECEIVE], proto.reverse))).toThrow(ForbiddenException);
    expect(P.DOC_INTAKE_RECEIVE).not.toBe(P.DOC_RECEIVE);
  });

  // Receiving is a person witnessing that paper arrived. A key cannot witness it, and the log is
  // worth nothing if a machine can write rows naming a user into it.
  it('bars API keys from the whole controller', () => {
    const classGuards = (Reflect.getMetadata('__guards__', DocumentIntakeController) as unknown[]) ?? [];
    expect(classGuards).toContain(ApiKeyDenyGuard);
  });
});
