import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from './jwt.strategy';

/**
 * Channel-level cap: rejects any request authenticated by an API key, regardless of the
 * bound user's grants. Applied to approval-class endpoints (approve / reject / delegate) so
 * a key can never approve — the prohibition is a property of the authentication channel, not
 * an expressible permission (spec: "API Keys Cannot Approve"; preserves invariant #8).
 *
 * Place AFTER an authenticating guard (JwtOrApiKeyGuard) so `request.user` is populated.
 */
@Injectable()
export class ApiKeyDenyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (user?.authSource === 'api-key') {
      throw new ForbiddenException('API keys cannot perform approval actions');
    }
    return true;
  }
}
