import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from './require-permissions.decorator';
import type { AuthUser } from './jwt.strategy';

/**
 * Authorizes by permission CODE. Reads the required codes set by @RequirePermissions (ALL must
 * be held) and @RequireAnyPermission (at least ONE must be held) and checks them against the
 * codes carried in the JWT (request.user.permissions). Where an endpoint declares both, both
 * gates must pass. Role names are never consulted (invariant 6).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const anyOf = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const needsAll = required && required.length > 0;
    const needsAny = anyOf && anyOf.length > 0;
    if (!needsAll && !needsAny) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    const granted = new Set(user?.permissionCodes ?? []);
    const ok =
      (!needsAll || required.every((code) => granted.has(code))) &&
      (!needsAny || anyOf.some((code) => granted.has(code)));
    if (!ok) {
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}
