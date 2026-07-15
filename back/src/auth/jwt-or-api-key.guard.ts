import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { RequestContext } from '../common/context/request-context';
import { ApiKeyService } from '../modules/external-api/api-key.service';
import type { AuthUser } from './jwt.strategy';

/**
 * Accepts EITHER authentication source and produces the identical `AuthUser`:
 *  - a company-context JWT (`Authorization: Bearer <jwt>`) — delegates to the passport
 *    'jwt' strategy, exactly as JwtAuthGuard does; or
 *  - an API key (`Authorization: Api-Key <prefix>.<secret>` or `X-Api-Key: <...>`) —
 *    resolves the key to the bound user's live, company-scoped grants.
 *
 * On the API-key path it also back-fills the request's AsyncLocalStorage context (userId /
 * companyId / departmentId / grants) — which the middleware left empty for a non-Bearer
 * request — so the company-scope filter and CompanyScopeService work unchanged downstream.
 *
 * API-key requests are barred from approval actions by the separate ApiKeyDenyGuard; this
 * guard only authenticates.
 */
@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard('jwt') {
  constructor(private readonly apiKeys: ApiKeyService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const cred = extractApiKeyCredential(req);
    if (!cred) {
      // No key presented — fall back to the JWT strategy (sets request.user).
      return (await super.canActivate(context)) as boolean;
    }

    const user = await this.apiKeys.authenticate(cred);
    req.user = user;

    // Populate the request context the middleware left empty (no Bearer token), so the
    // company-scope filter resolves the active company for this API-key request too.
    const store = RequestContext.get();
    if (store) {
      store.userId = user.userId;
      store.companyId = user.companyId;
      store.departmentId = user.departmentId;
      store.grants = user.grants;
      store.apiKeyId = user.apiKeyId;
    }

    // Best-effort, out-of-band usage marker — never awaited, never fails the request.
    if (user.apiKeyId) this.apiKeys.touchLastUsed(user.apiKeyId);
    return true;
  }
}

/** Extract a raw API-key secret from `Authorization: Api-Key <...>` or `X-Api-Key: <...>`. */
export function extractApiKeyCredential(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && /^Api-Key /i.test(auth)) {
    const value = auth.slice(auth.indexOf(' ') + 1).trim();
    return value.length > 0 ? value : null;
  }
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header.trim().length > 0) return header.trim();
  return null;
}
