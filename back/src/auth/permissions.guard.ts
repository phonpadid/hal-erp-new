import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './require-permissions.decorator';
import type { AuthUser } from './jwt.strategy';

/**
 * Authorizes by permission CODE. Reads the required codes set by
 * @RequirePermissions and checks them against the codes carried in the JWT
 * (request.user.permissions). Role names are never consulted (invariant 6).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    const granted = new Set(user?.permissionCodes ?? []);
    const ok = required.every((code) => granted.has(code));
    if (!ok) {
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}
