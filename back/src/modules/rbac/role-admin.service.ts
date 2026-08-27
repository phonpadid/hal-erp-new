import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { pageParams, type Paginated, type PaginationQueryDto, SearchablePaginationQueryDto, withSearch } from '../../common/pagination/pagination';
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

/** What a bulk write did with one item, so the caller can report partial outcomes. */
export type BulkSkipReason = 'ALREADY_HELD' | 'ALREADY_HELD_SAME_SCOPE' | 'NOT_HELD';
export interface BulkWriteResult {
  applied: string[];
  skipped: Array<{ item: string; reason: BulkSkipReason }>;
}

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

  // ---- Active-company guards -----------------------------------------------
  // Company isolation is enforced by resolving every id the caller names against the
  // active company BEFORE anything is written. Shared by the single-item and bulk
  // writes so the two paths cannot drift on what "belongs to this company" means.

  /** The named role, or 404 if it doesn't exist or belongs to another company. */
  private async requireRole(em: EntityManager, roleId: string, companyId: string): Promise<Role> {
    const role = await em.findOne(Role, { id: roleId }, FILTER_OFF);
    if (!role || role.company.id !== companyId) throw new NotFoundException(`Role ${roleId} not found`);
    return role;
  }

  /** The named department, or 404 if it doesn't exist or belongs to another company. */
  private async requireDepartment(
    em: EntityManager,
    departmentId: string,
    companyId: string,
  ): Promise<Department> {
    const dept = await em.findOne(Department, { id: departmentId }, FILTER_OFF);
    if (!dept || dept.company.id !== companyId) {
      throw new NotFoundException(`Department ${departmentId} not found`);
    }
    return dept;
  }

  /**
   * Resolve permission codes to catalog rows, rejecting the whole set if any code is
   * unknown — a batch is validated in full before it writes anything.
   */
  private async requirePermissions(em: EntityManager, codes: string[]): Promise<Map<string, Permission>> {
    const unique = [...new Set(codes)];
    if (!unique.length) return new Map();
    const found = await em.find(Permission, { code: { $in: unique } });
    const byCode = new Map(found.map((p) => [p.code, p]));
    const missing = unique.filter((c) => !byCode.has(c));
    if (missing.length) {
      throw new BadRequestException(`Unknown permission code(s): ${missing.join(', ')}`);
    }
    return byCode;
  }

  /** Create a role in the active company. */
  /**
   * Add a role to the active company.
   *
   * `code` is unique per company, so a repeat is a 409, not a 500: the admin typed a code that is
   * already taken, which is theirs to fix — surfacing the raw constraint violation told them only
   * that something broke. Checked first for the common case and caught for the concurrent one,
   * mirroring how every other admin surface here handles its own uniqueness.
   */
  async createRole(input: { code: string; name: string; description?: string }): Promise<Role> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    // filters off like every other read here: `company: companyId` IS the scope, and the
    // default filter has no argument bound on a bare fork.
    const dup = await em.findOne(Role, { company: companyId, code: input.code }, FILTER_OFF);
    if (dup) throw new ConflictException(`Role code '${input.code}' already exists in this company`);

    const role = em.create(Role, {
      company: em.getReference(Company, companyId),
      code: input.code,
      name: input.name,
      description: input.description,
      isActive: true,
    });
    try {
      await em.persistAndFlush(role);
    } catch (e) {
      // Lost the unique race with a concurrent create — still a 409.
      if (e instanceof UniqueConstraintViolationException) {
        throw new ConflictException(`Role code '${input.code}' already exists in this company`);
      }
      throw e;
    }
    return role;
  }

  /** Attach a permission (by code) to a role at a given scope. */
  async attachPermission(roleId: string, permissionCode: string, scope: Scope): Promise<RolePermission> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    await this.requireRole(em, roleId, companyId);
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
    // Company isolation: the role and department must be this company's before we write.
    // Without these the caller could plant an assignment pointing at another company's rows.
    await this.requireRole(em, input.roleId, companyId);
    await this.requireDepartment(em, input.departmentId, companyId);
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

  // ---- Bulk writes ---------------------------------------------------------
  // A batch expresses "make it so" over a set the admin selected visually, so an
  // already-satisfied item is SKIPPED rather than fatal. The single-item routes keep
  // their strict 409 — there a duplicate is a genuine mistake worth surfacing.

  /**
   * Apply a batch of grants and detaches to one role in a single transaction.
   *
   * Validate-all-then-write: every code is resolved and the role is confirmed to be this
   * company's before anything is written, so an invalid item rejects the whole batch —
   * a partially-applied access change is worse than a rejected one, because the admin is
   * left unsure what took effect.
   *
   * The client's notion of "held" is not trusted: current grants are re-read inside the
   * transaction and outcomes derived here, so a stale tab produces a skip, not a 409.
   */
  async attachPermissionsBulk(
    roleId: string,
    grants: Array<{ permissionCode: string; scope: Scope }>,
    detach: string[],
  ): Promise<BulkWriteResult> {
    const companyId = RequestContext.companyId()!;
    return this.em.transactional(async (em) => {
      await this.requireRole(em, roleId, companyId);
      const byCode = await this.requirePermissions(em, [
        ...grants.map((g) => g.permissionCode),
        ...detach,
      ]);

      const current = await em.find(RolePermission, { role: roleId }, FILTER_OFF);
      const heldByPermId = new Map(current.map((rp) => [rp.permission.id, rp]));
      const result: BulkWriteResult = { applied: [], skipped: [] };

      for (const g of grants) {
        const permission = byCode.get(g.permissionCode)!;
        const held = heldByPermId.get(permission.id);
        if (!held) {
          em.persist(em.create(RolePermission, { role: em.getReference(Role, roleId), permission, scope: g.scope }));
          result.applied.push(g.permissionCode);
        } else if (held.scope !== g.scope) {
          // (role_id, permission_id) is unique — a scope change UPDATEs the row in place
          // rather than inserting a second grant for the same code.
          held.scope = g.scope;
          result.applied.push(g.permissionCode);
        } else {
          result.skipped.push({ item: g.permissionCode, reason: 'ALREADY_HELD_SAME_SCOPE' });
        }
      }

      for (const code of detach) {
        const held = heldByPermId.get(byCode.get(code)!.id);
        if (!held) {
          result.skipped.push({ item: code, reason: 'NOT_HELD' });
          continue;
        }
        em.remove(held);
        result.applied.push(code);
      }

      await em.flush();
      return result;
    });
  }

  /**
   * Assign several roles to one user against a shared context (department, default flag,
   * validity window) in a single transaction.
   *
   * `user_company_role` is unique on (user_id, company_id, role_id) — a user holds each role
   * once per company regardless of department, which is what makes a single shared department
   * for the whole batch correct rather than lossy.
   */
  async assignUserRolesBulk(input: {
    userId: string;
    departmentId: string;
    roleIds: string[];
    isDefault?: boolean;
    validFrom?: string;
    validTo?: string;
  }): Promise<BulkWriteResult> {
    const companyId = RequestContext.companyId()!;
    if (input.validFrom && input.validTo && input.validTo < input.validFrom) {
      throw new BadRequestException('validTo must be on or after validFrom');
    }
    return this.em.transactional(async (em) => {
      await this.requireDepartment(em, input.departmentId, companyId);
      const roleIds = [...new Set(input.roleIds)];
      const roles = await Promise.all(roleIds.map((id) => this.requireRole(em, id, companyId)));

      const existing = await em.find(
        UserCompanyRole,
        { user: input.userId, company: companyId },
        FILTER_OFF,
      );
      const heldRoleIds = new Set(existing.map((a) => a.role.id));
      const result: BulkWriteResult = { applied: [], skipped: [] };

      // is_default marks the company a user enters at login, so it can apply to at most one
      // assignment in the batch. Give it to the first role actually created.
      let defaultPending = input.isDefault ?? false;

      for (const role of roles) {
        if (heldRoleIds.has(role.id)) {
          result.skipped.push({ item: role.code, reason: 'ALREADY_HELD' });
          continue;
        }
        em.persist(
          em.create(UserCompanyRole, {
            user: em.getReference(AppUser, input.userId),
            company: em.getReference(Company, companyId),
            department: em.getReference(Department, input.departmentId),
            role,
            isDefault: defaultPending,
            validFrom: input.validFrom,
            validTo: input.validTo,
          }),
        );
        defaultPending = false;
        result.applied.push(role.code);
      }

      await em.flush();
      return result;
    });
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

  /**
   * Create a service account — a non-human identity authenticated only by API key — together with
   * its first company-role assignment, atomically.
   *
   * Both writes commit together because an account with no membership can neither log in (it has
   * no password by construction) nor be issued an API key (`eligibleUsers` requires an ACTIVE
   * membership in the active company), so a half-created one would be inert but confusing.
   *
   * Deliberately unlike `EmployeeService.onboard()`: no password is accepted and none is read from
   * USER_PASSWORD, and no verification email is sent. `emailVerifiedAt` is stamped so the account
   * is never reported as a person awaiting verification; it cannot be used to log in because
   * `isServiceAccount` bars that door regardless.
   */
  async createServiceAccount(input: {
    username: string;
    email: string;
    roleId: string;
    departmentId: string;
  }): Promise<{ id: string; username: string; email: string; isServiceAccount: boolean }> {
    const companyId = RequestContext.companyId()!;
    return this.em.transactional(async (em) => {
      // Role and department must belong to the active company (no cross-company grants).
      const role = await em.findOne(Role, { id: input.roleId, company: companyId }, FILTER_OFF);
      if (!role) throw new BadRequestException(`Unknown role '${input.roleId}'`);
      const dept = await em.findOne(
        Department,
        { id: input.departmentId, company: companyId },
        FILTER_OFF,
      );
      if (!dept) throw new BadRequestException(`Unknown department '${input.departmentId}'`);

      const user = em.create(AppUser, {
        username: input.username,
        email: input.email,
        isServiceAccount: true,
        status: 'ACTIVE',
        // Verified on creation: nothing is ever mailed here, and leaving it null would show the
        // bot as a pending human in any view that surfaces verification state.
        emailVerifiedAt: new Date(),
        createdAt: new Date(),
      });
      em.create(UserCompanyRole, {
        user,
        company: em.getReference(Company, companyId),
        department: dept,
        role,
        isDefault: true,
      });
      try {
        await em.flush();
      } catch (e) {
        if (e instanceof UniqueConstraintViolationException) {
          throw new ConflictException('Username or email already in use');
        }
        throw e;
      }
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        isServiceAccount: user.isServiceAccount,
      };
    });
  }

  /** All users (paged) with their assignments in the active company (accounts are global). */
  async listUsers(
    q: SearchablePaginationQueryDto = {},
  ): Promise<
    Paginated<{
      id: string; username: string; email: string; status: string; isServiceAccount: boolean;
      assignments: Array<{ id: string; roleId: string; roleCode: string; departmentId: string; departmentName: string; isDefault: boolean; validFrom?: string; validTo?: string }>;
    }>
  > {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const { page, limit, offset } = pageParams(q);
    // Searched by what an administrator reads on the row. The term goes to the SERVER because this
    // list pages there: filtering the loaded page would search 20 of eighty-odd accounts while
    // looking like it had searched all of them.
    const where = withSearch<AppUser>({}, q.search, ['username', 'email']);
    const [users, total] = await em.findAndCount(AppUser, where, { orderBy: { username: 'ASC' }, offset, limit });
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
    // isServiceAccount drives the admin badge and the suppression of person-only actions.
    const items = users.map((u) => ({ id: u.id, username: u.username, email: u.email, status: u.status, isServiceAccount: u.isServiceAccount, assignments: byUser.get(u.id) ?? [] }));
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
