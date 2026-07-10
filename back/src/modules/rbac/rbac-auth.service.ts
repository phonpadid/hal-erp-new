import { EntityManager } from '@mikro-orm/postgresql';
import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { StorageService } from '../../common/storage/storage.service';
import { MembershipService } from './membership.service';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import { AppUser, Employee, UserCompanyRole } from './rbac.entities';
import { Company } from '../multi-company/multi-company.entities';
import type { AccessibleCompany } from './membership.service';

// Company-scoped entities carry a default `company` filter that throws unless fed args;
// every query here scopes explicitly by companyId, so it disables the filter (see
// profile.service.ts for the same pattern).
const FILTER_OFF = { filters: { company: false } } as const;

/** Compact identity for the header/sidebar: who is signed in, in the active company. */
export interface UserIdentity {
  username: string;
  // Employee full name in the active company when linked, else the username.
  displayName: string;
  // First role held in the active company, else null (no membership / no company).
  roleName: string | null;
  // Longer-lived presigned URL for the user's 1:1 profile image (sidebar/topbar), or null.
  profileImageUrl: string | null;
}

export interface LoginResult {
  user: { id: string; username: string };
  companies: AccessibleCompany[];
  accessToken: string | null; // issued for the default/sole company, else null
}

export interface ContextResult {
  accessToken: string;
  companyId: string;
}

/**
 * Authentication orchestration (rbac: Single Login, Company Context Token).
 * Verifies credentials, resolves accessible companies, and issues company-context
 * tokens carrying the resolved department + scoped grants.
 */
@Injectable()
export class RbacAuthService {
  constructor(
    private readonly em: EntityManager,
    private readonly passwords: PasswordService,
    private readonly resolver: PermissionResolverService,
    private readonly memberships: MembershipService,
    private readonly tokens: AuthService,
    private readonly storage: StorageService,
  ) {}

  // Sidebar avatars persist across a session, so sign their URL for longer than the default TTL.
  private static readonly PROFILE_IMAGE_TTL = 6 * 60 * 60; // 6 hours

  async login(username: string, password: string): Promise<LoginResult> {
    // Generic failure (no user enumeration) for unknown user / bad password / inactive.
    const user = await this.em.fork().findOne(AppUser, { username });
    const ok =
      !!user &&
      user.status === 'ACTIVE' &&
      !!user.passwordHash &&
      (await this.passwords.verify(password, user.passwordHash));
    if (!user || !ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    // Distinct outcome (not the generic credentials error) so the UI can prompt to verify.
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('EMAIL_NOT_VERIFIED');
    }

    const companies = await this.memberships.listForUser(user.id);
    const target = companies.find((c) => c.isDefault) ?? (companies.length === 1 ? companies[0] : undefined);

    let accessToken: string | null = null;
    if (target) {
      accessToken = (await this.issueFor(user.id, target.id)).accessToken;
    }

    return { user: { id: user.id, username: user.username }, companies, accessToken };
  }

  /** Re-issue a token for another company the user actively belongs to. */
  async switchCompany(userId: string, companyId: string): Promise<ContextResult> {
    return this.issueFor(userId, companyId);
  }

  /**
   * Compact identity for the header/sidebar (display name + role), resolved strictly within
   * the active company (invariant 1). Both the linked employee and the membership may be
   * absent — falls back to the username and a null role. Never exposes password_hash.
   */
  async identity(userId: string, companyId: string | null): Promise<UserIdentity> {
    const em = this.em.fork();
    const user = await em.findOne(AppUser, { id: userId });
    if (!user) {
      throw new UnauthorizedException('Unknown account');
    }

    const employee = companyId
      ? await em.findOne(Employee, { user: userId, company: companyId }, FILTER_OFF)
      : null;
    const membership = companyId
      ? await em.findOne(UserCompanyRole, { user: userId, company: companyId }, { ...FILTER_OFF, populate: ['role'] })
      : null;

    return {
      username: user.username,
      displayName: employee?.fullName ?? user.username,
      roleName: membership?.role.name ?? null,
      profileImageUrl: user.profileImagePath
        ? await this.storage.presignDownload(user.profileImagePath, RbacAuthService.PROFILE_IMAGE_TTL)
        : null,
    };
  }

  /** The active company's base currency (code + decimal places), for the UI to convert/format. */
  async baseCurrency(companyId: string): Promise<{ code: string; decimalPlaces: number } | null> {
    const company = await this.em.fork().findOne(Company, { id: companyId }, { populate: ['baseCurrency'] });
    const cur = company?.baseCurrency;
    return cur ? { code: cur.code, decimalPlaces: cur.decimalPlaces } : null;
  }

  private async issueFor(userId: string, companyId: string): Promise<ContextResult> {
    // Defense in depth: never issue a company token for an unverified email (verification is one-way,
    // so a valid token already implies verified — this guards direct switch-company calls).
    const user = await this.em.fork().findOne(AppUser, { id: userId });
    if (!user?.emailVerifiedAt) {
      throw new ForbiddenException('EMAIL_NOT_VERIFIED');
    }
    const resolution = await this.resolver.resolve(userId, companyId);
    if (!resolution) {
      // No active membership in the target company.
      throw new UnauthorizedException('No access to the requested company');
    }
    const { accessToken } = this.tokens.issueToken(
      userId,
      companyId,
      resolution.departmentId,
      resolution.grants,
    );
    return { accessToken, companyId };
  }
}
