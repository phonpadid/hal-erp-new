import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { pageParams, type Paginated, type PaginationQueryDto } from '../../common/pagination/pagination';
import { Company, Department } from '../multi-company/multi-company.entities';
import {
  AppUser,
  Permission,
  Role,
  RolePermission,
  UserCompanyRole,
} from './rbac.entities';
import { PermissionResolverService } from './permission-resolver.service';
import { RbacPermissions } from './permissions';
import type { Scope } from '../../common/enums';

const FILTER_OFF = { filters: { company: false } } as const;

/** A single active assignment of a user in one company (cross-company read). */
export interface CrossCompanyAssignment {
  id: string;
  companyId: string;
  companyCode: string;
  companyName: string;
  roleId: string;
  roleCode: string;
  departmentId: string;
  departmentName: string;
  isDefault: boolean;
  validFrom?: string;
  validTo?: string;
}

/**
 * Minimal admin surface (guarded by RBAC_MANAGE) to set up roles, attach
 * permissions with a scope, and assign users — enough to make authorization usable.
 * Also hosts the resignation revoke (rbac: Resignation Affects One Company Only).
 */
@Injectable()
export class RoleAdminService {
  constructor(
    private readonly em: EntityManager,
    private readonly resolver: PermissionResolverService,
  ) {}

  /** Create a role in the active company. */
  async createRole(input: { code: string; name: string; description?: string }): Promise<Role> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const role = em.create(Role, {
      company: em.getReference(Company, companyId),
      code: input.code,
      name: input.name,
      description: input.description,
      isActive: true,
    });
    await em.persistAndFlush(role);
    return role;
  }

  /** Attach a permission (by code) to a role at a given scope. */
  async attachPermission(roleId: string, permissionCode: string, scope: Scope): Promise<RolePermission> {
    const em = this.em.fork();
    const permission = await em.findOne(Permission, { code: permissionCode });
    if (!permission) {
      throw new BadRequestException(`Unknown permission code '${permissionCode}'`);
    }
    // A role may hold a permission only once (unique role+permission). Re-adding an
    // existing grant would hit the DB constraint and surface as a raw 500 — reject it
    // up front with a clear conflict instead. To change a grant's scope, detach + re-add.
    const existing = await em.findOne(
      RolePermission,
      { role: roleId, permission },
      FILTER_OFF,
    );
    if (existing) {
      throw new ConflictException(`Role already has permission '${permissionCode}'`);
    }
    const rp = em.create(RolePermission, {
      role: em.getReference(Role, roleId),
      permission,
      scope,
    });
    await em.persistAndFlush(rp);
    return rp;
  }

  /** Assign a user a role in the active company, with an optional validity window. */
  async assignUserRole(input: {
    userId: string;
    departmentId: string;
    roleId: string;
    isDefault?: boolean;
    validFrom?: string;
    validTo?: string;
  }): Promise<UserCompanyRole> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const ucr = em.create(UserCompanyRole, {
      user: em.getReference(AppUser, input.userId),
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, input.departmentId),
      role: em.getReference(Role, input.roleId),
      isDefault: input.isDefault ?? false,
      validFrom: input.validFrom,
      validTo: input.validTo,
    });
    await em.persistAndFlush(ucr);
    return ucr;
  }

  // ---- Reads (RBAC_MANAGE) -------------------------------------------------

  /** The active company's roles (paged), each with its permission grants. */
  async listRoles(
    q: PaginationQueryDto = {},
  ): Promise<
    Paginated<{ id: string; code: string; name: string; isActive: boolean; permissions: Array<{ code: string; name: string; scope: string }> }>
  > {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const { page, limit, offset } = pageParams(q);
    const [roles, total] = await em.findAndCount(
      Role,
      { company: companyId },
      { ...FILTER_OFF, orderBy: { code: 'ASC' }, offset, limit },
    );
    const grants = await em.find(RolePermission, { role: { $in: roles.map((r) => r.id) } }, FILTER_OFF);
    // Batch-resolve the permission catalog by id (robust vs. per-row relation loads).
    const permIds = [...new Set(grants.map((g) => g.permission.id))];
    const perms = permIds.length ? await em.find(Permission, { id: { $in: permIds } }) : [];
    const permById = new Map(perms.map((p) => [p.id, p]));
    const byRole = new Map<string, Array<{ code: string; name: string; scope: string }>>();
    for (const g of grants) {
      const perm = permById.get(g.permission.id);
      if (!perm) continue;
      const list = byRole.get(g.role.id) ?? [];
      list.push({ code: perm.code, name: perm.name, scope: g.scope });
      byRole.set(g.role.id, list);
    }
    const items = roles.map((r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.isActive, permissions: byRole.get(r.id) ?? [] }));
    return { items, total, page, limit };
  }

  /** The permission catalog (active codes, paged) for the grant picker. */
  async listPermissions(
    q: PaginationQueryDto = {},
  ): Promise<Paginated<{ code: string; name: string; module: string }>> {
    const { page, limit, offset } = pageParams(q);
    const [perms, total] = await this.em
      .fork()
      .findAndCount(Permission, { isActive: true }, { orderBy: { code: 'ASC' }, offset, limit });
    const items = perms.map((p) => ({ code: p.code, name: p.name, module: p.module }));
    return { items, total, page, limit };
  }

  /** All users (paged) with their assignments in the active company (accounts are global). */
  async listUsers(
    q: PaginationQueryDto = {},
  ): Promise<
    Paginated<{
      id: string; username: string; email: string; status: string;
      assignments: Array<{ id: string; roleId: string; roleCode: string; departmentId: string; departmentName: string; isDefault: boolean; validFrom?: string; validTo?: string }>;
    }>
  > {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const { page, limit, offset } = pageParams(q);
    const [users, total] = await em.findAndCount(AppUser, {}, { orderBy: { username: 'ASC' }, offset, limit });
    const ucrs = await em.find(UserCompanyRole, { company: companyId }, FILTER_OFF);
    const roleById = new Map((await em.find(Role, { company: companyId }, FILTER_OFF)).map((r) => [r.id, r]));
    const deptById = new Map((await em.find(Department, { company: companyId }, FILTER_OFF)).map((d) => [d.id, d]));
    const byUser = new Map<string, any[]>();
    for (const u of ucrs) {
      const role = roleById.get(u.role.id);
      const dept = deptById.get(u.department.id);
      const list = byUser.get(u.user.id) ?? [];
      list.push({
        id: u.id, roleId: u.role.id, roleCode: role?.code ?? '',
        departmentId: u.department.id, departmentName: dept?.name ?? '',
        isDefault: u.isDefault, validFrom: u.validFrom, validTo: u.validTo,
      });
      byUser.set(u.user.id, list);
    }
    const items = users.map((u) => ({ id: u.id, username: u.username, email: u.email, status: u.status, assignments: byUser.get(u.id) ?? [] }));
    return { items, total, page, limit };
  }

  /**
   * One user's ACTIVE assignments across every company the REQUESTER administers
   * (holds RBAC_MANAGE in). Read-only: returns the intersection of the target's
   * companies and the requester's admin companies, never disabling the company filter
   * to leak companies the requester has no authority over.
   */
  async crossCompanyAssignments(targetUserId: string): Promise<CrossCompanyAssignment[]> {
    const requesterId = RequestContext.userId()!;
    const today = new Date().toISOString().slice(0, 10);
    const activeWindow = {
      $and: [
        { $or: [{ validFrom: null }, { validFrom: { $lte: today } }] },
        { $or: [{ validTo: null }, { validTo: { $gte: today } }] },
      ],
    };
    const em = this.em.fork();

    // Companies the requester is an active member of (candidate admin companies).
    const myMemberships = await em.find(
      UserCompanyRole,
      { user: requesterId, ...activeWindow },
      FILTER_OFF,
    );
    const myCompanyIds = [...new Set(myMemberships.map((m) => m.company.id))];

    // Of those, keep only the ones where the requester actually resolves RBAC_MANAGE.
    const adminCompanyIds = new Set<string>();
    for (const companyId of myCompanyIds) {
      const res = await this.resolver.resolve(requesterId, companyId);
      if (res?.grants.some((g) => g.code === RbacPermissions.RBAC_MANAGE)) {
        adminCompanyIds.add(companyId);
      }
    }
    if (adminCompanyIds.size === 0) return [];

    // The target user's active assignments, intersected with the admin companies.
    const rows = await em.find(
      UserCompanyRole,
      { user: targetUserId, company: { $in: [...adminCompanyIds] }, ...activeWindow },
      { ...FILTER_OFF, populate: ['company', 'role', 'department'] },
    );

    return rows.map((r) => {
      const company = r.company as Company;
      return {
        id: r.id,
        companyId: company.id,
        companyCode: company.code,
        companyName: company.nameTh,
        roleId: r.role.id,
        roleCode: r.role.code,
        departmentId: r.department.id,
        departmentName: r.department.name,
        isDefault: r.isDefault,
        validFrom: r.validFrom,
        validTo: r.validTo,
      };
    });
  }

  // ---- Fine-grained removes ------------------------------------------------

  /** Detach one permission grant from a role (active company only). */
  async detachPermission(roleId: string, permissionCode: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const role = await em.findOne(Role, { id: roleId }, FILTER_OFF);
    if (!role || role.company.id !== companyId) throw new NotFoundException(`Role ${roleId} not found`);
    const permission = await em.findOne(Permission, { code: permissionCode });
    if (!permission) throw new NotFoundException(`Unknown permission '${permissionCode}'`);
    await em.nativeDelete(RolePermission, { role: roleId, permission: permission.id });
  }

  /** Remove a single user-role assignment (active company only). */
  async removeAssignment(assignmentId: string): Promise<void> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const ucr = await em.findOne(UserCompanyRole, { id: assignmentId }, FILTER_OFF);
    if (!ucr || ucr.company.id !== companyId) throw new NotFoundException(`Assignment ${assignmentId} not found`);
    await em.removeAndFlush(ucr);
  }

  /**
   * Revoke a user's access to ONE company by expiring that company's memberships
   * (valid_to = today). The shared app_user and other companies are untouched.
   * Returns the number of memberships expired.
   */
  async revokeCompanyAccess(userId: string, companyId: string): Promise<number> {
    // Effective immediately: set valid_to to the day before today, so resolution
    // (valid_to >= today) excludes these memberships from now on.
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);

    const em = this.em.fork();
    const memberships = await em.find(
      UserCompanyRole,
      { user: userId, company: companyId },
      { filters: { company: false } },
    );
    for (const m of memberships) {
      m.validTo = yesterday;
    }
    await em.flush();
    return memberships.length;
  }
}
