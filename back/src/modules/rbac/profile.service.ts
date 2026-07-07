import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Scope } from '../../common/enums';
import { PasswordService } from './password.service';
import { PermissionResolverService } from './permission-resolver.service';
import { AppUser, Employee, UserCompanyRole } from './rbac.entities';

// The default `company` filter (CompanyScopedEntity) throws unless fed args, and no
// caller in this codebase feeds it — every company-scoped query disables it and scopes
// explicitly via a `company: companyId` condition instead (see role-admin.service.ts).
const FILTER_OFF = { filters: { company: false } } as const;

/** The signed-in user's own profile: identity + (optional) linked-employee display fields. */
export interface OwnProfile {
  username: string;
  email: string;
  emailVerifiedAt: Date | null;
  status: string;
  // Present only when an employee row links to this user in the ACTIVE company.
  employee: { fullName: string; position: string | null; departmentName: string } | null;
  // Role(s) held via user_company_role and the resolved permission grants, both scoped
  // to the ACTIVE company. A user may hold more than one role per company.
  roles: string[];
  permissions: { code: string; scope: Scope }[];
}

/**
 * Own-account surface for an authenticated user (user-profile): read own profile and
 * change own password. The user is always resolved from the JWT — never an id in the
 * path — so a user can only ever read or mutate their own account.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly em: EntityManager,
    private readonly passwords: PasswordService,
    private readonly resolver: PermissionResolverService,
  ) {}

  /**
   * The signed-in user's profile. The linked employee, roles, and permissions are all
   * resolved strictly within the active company (invariant 1: company isolation) and may
   * be absent — some accounts have no employee row or no membership there. Never exposes
   * password_hash. Permissions reuse PermissionResolverService (the same resolution the
   * authorization guard applies) so this read can never drift from what is enforced.
   */
  async getProfile(userId: string, companyId: string | null): Promise<OwnProfile> {
    const em = this.em.fork();
    const user = await em.findOne(AppUser, { id: userId });
    if (!user) {
      // The token names a user that no longer exists.
      throw new UnauthorizedException('Unknown account');
    }

    const employee = companyId
      ? await em.findOne(Employee, { user: userId, company: companyId }, { ...FILTER_OFF, populate: ['department'] })
      : null;

    const memberships = companyId
      ? await em.find(
          UserCompanyRole,
          { user: userId, company: companyId },
          { ...FILTER_OFF, populate: ['role'] },
        )
      : [];
    const resolution = companyId ? await this.resolver.resolve(userId, companyId) : null;

    return {
      username: user.username,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      status: user.status,
      employee: employee
        ? {
            fullName: employee.fullName,
            position: employee.position ?? null,
            departmentName: employee.department.name,
          }
        : null,
      roles: memberships.map((m) => m.role.name),
      permissions: resolution?.grants ?? [],
    };
  }

  /**
   * Change the signed-in user's password. Verifies the CURRENT password against
   * app_user.password_hash with the same primitive login uses, then overwrites the hash.
   * No email, no password_reset_token. A wrong current password is a generic 401 (no
   * hashing details leaked); new === current is a 400 (also enforced by the DTO pipe).
   * Runs in one transaction with a row lock so concurrent changes can't interleave.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const newHash = await this.passwords.hash(newPassword);

    await this.em.transactional(async (em) => {
      const user = await em.findOne(AppUser, { id: userId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      const ok = !!user && !!user.passwordHash && (await this.passwords.verify(currentPassword, user.passwordHash));
      if (!user || !ok) {
        throw new UnauthorizedException('Current password is incorrect');
      }
      // Defense in depth: the shared schema already rejects this at the DTO boundary.
      if (currentPassword === newPassword) {
        throw new BadRequestException('New password must differ from the current password');
      }
      user.passwordHash = newHash;
    });
  }
}
