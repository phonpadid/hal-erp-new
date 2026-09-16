import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Grant, JwtPayload } from './jwt-payload.interface';

/** The authenticated principal attached to `request.user`. */
export interface AuthUser {
  userId: string;
  companyId: string;
  departmentId: string;
  /** See `JwtPayload.departmentIds`; filled from `departmentId` when the token predates the claim. */
  departmentIds: string[];
  grants: Grant[];
  /** Derived convenience for the permission-code guard. */
  permissionCodes: string[];
  /** How the request authenticated. API-key requests are barred from approval actions. */
  authSource?: 'jwt' | 'api-key';
  /** The originating api_key.id when authSource === 'api-key' (for audit attribution). */
  apiKeyId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'change-me-in-production',
    });
  }

  validate(payload: JwtPayload): AuthUser {
    const grants = payload.grants ?? [];
    return {
      userId: payload.sub,
      companyId: payload.companyId,
      departmentId: payload.departmentId,
      departmentIds: payload.departmentIds?.length ? payload.departmentIds : [payload.departmentId],
      grants,
      permissionCodes: grants.map((g) => g.code),
      authSource: 'jwt',
    };
  }
}
