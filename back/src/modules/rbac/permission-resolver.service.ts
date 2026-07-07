import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Scope } from '../../common/enums';
import { RolePermission, UserCompanyRole } from './rbac.entities';
import type { Grant } from '../../auth/jwt-payload.interface';

export interface RbacResolution {
  departmentId: string;
  grants: Grant[];
}

// Broadest scope wins on conflict (rbac: Permission Aggregation).
const SCOPE_RANK: Record<Scope, number> = {
  [Scope.OWN]: 0,
  [Scope.DEPARTMENT]: 1,
  [Scope.COMPANY]: 2,
  [Scope.GROUP]: 3,
};

@Injectable()
export class PermissionResolverService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Resolve a user's department + scoped permission grants for one company.
   * Returns null when the user has no ACTIVE (non-expired) membership there.
   */
  async resolve(userId: string, companyId: string): Promise<RbacResolution | null> {
    const today = new Date().toISOString().slice(0, 10);
    const em = this.em.fork();

    // user_company_role is company-scoped; we scope explicitly by companyId here
    // and disable the global company filter (it needs params we set per-request).
    const memberships = await em.find(
      UserCompanyRole,
      {
        user: userId,
        company: companyId,
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: today } }] },
          { $or: [{ validTo: null }, { validTo: { $gte: today } }] },
        ],
      },
      { filters: { company: false }, populate: ['role', 'department'] },
    );

    if (memberships.length === 0) return null;

    const primary = memberships.find((m) => m.isDefault) ?? memberships[0];
    const departmentId = primary.department.id;

    const roleIds = memberships.map((m) => m.role.id);
    const rolePerms = await em.find(
      RolePermission,
      { role: { $in: roleIds } },
      // role → Role is company-scoped; disable the filter (we already scoped by company).
      { filters: { company: false }, populate: ['permission'] },
    );

    // Union by code, keeping the broadest scope; skip inactive permissions.
    const byCode = new Map<string, Scope>();
    for (const rp of rolePerms) {
      if (!rp.permission.isActive) continue;
      const code = rp.permission.code;
      const current = byCode.get(code);
      if (current === undefined || SCOPE_RANK[rp.scope] > SCOPE_RANK[current]) {
        byCode.set(code, rp.scope);
      }
    }

    const grants: Grant[] = [...byCode.entries()].map(([code, scope]) => ({ code, scope }));
    return { departmentId, grants };
  }
}
