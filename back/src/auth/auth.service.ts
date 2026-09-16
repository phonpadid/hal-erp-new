import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Grant, JwtPayload } from './jwt-payload.interface';

/**
 * Token signing seam. The rbac capability resolves the company-context payload
 * (department + scoped grants) and asks this to sign it.
 */
@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  issueToken(
    userId: string,
    companyId: string,
    departmentId: string,
    grants: Grant[],
    departmentIds: string[] = [departmentId],
  ): { accessToken: string } {
    const payload: JwtPayload = { sub: userId, companyId, departmentId, departmentIds, grants };
    return { accessToken: this.jwt.sign(payload) };
  }
}
