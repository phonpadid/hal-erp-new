import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RequestContext } from './request-context';
import type { Grant, JwtPayload } from '../../auth/jwt-payload.interface';
import type { RequestContextStore } from './request-context';
import type { NextFunction, Request, Response } from 'express';

/**
 * Decodes the bearer token (if present) and runs the rest of the request inside
 * an AsyncLocalStorage context carrying userId / active companyId / permission
 * codes. Does NOT reject — authorization is the guards' job; this only populates
 * context so the company-scope filter and permission checks can read it.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const store: RequestContextStore = { grants: [] as Grant[] };

    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<JwtPayload>(auth.slice(7));
        store.userId = payload.sub;
        store.companyId = payload.companyId;
        store.departmentId = payload.departmentId;
        store.departmentIds = payload.departmentIds;
        store.grants = payload.grants ?? [];
      } catch {
        // Invalid/expired token → leave context empty; guards return 401/403.
      }
    }

    RequestContext.run(store, () => next());
  }
}
