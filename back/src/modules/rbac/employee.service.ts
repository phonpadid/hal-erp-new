import {
  UniqueConstraintViolationException,
  type FilterQuery,
} from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LinkableAccount } from '@erp/shared';
import { EmailVerificationService } from './email-verification.service';
import { PasswordService } from './password.service';
import { RequestContext } from '../../common/context/request-context';
import { EmploymentType } from '../../common/enums';
import {
  pageParams,
  type Paginated,
  type PaginationQueryDto,
} from '../../common/pagination/pagination';
import { Company, Department } from '../multi-company/multi-company.entities';
import { JobLevelService } from '../job-level/job-level.service';
import { AppUser, Employee, Role, UserCompanyRole } from './rbac.entities';
import { RbacPermissions } from './permissions';

const FILTER_OFF = { filters: { company: false } } as const;

/** Shape returned to clients. `salary` is present only for EMP_SALARY_VIEW holders. */
export interface EmployeeView {
  id: string;
  empCode: string;
  fullName: string;
  departmentId: string;
  departmentName: string;
  position?: string;
  jobLevel?: string;
  hireDate?: string;
  status: string;
  attendanceRequired: boolean;
  employmentType: string;
  /** Null means it inherits the department; the resolved answer is stamped at period close. */
  attendanceAffectsPay?: boolean | null;
  userId?: string;
  hasAccount: boolean;
  emailVerified: boolean;
  salary?: string;
}

export interface CreateEmployeeInput {
  empCode: string;
  fullName: string;
  departmentId: string;
  position?: string;
  jobLevel?: string;
  hireDate?: string;
  salary?: string;
  status?: string;
  attendanceRequired?: boolean;
  employmentType?: string;
  attendanceAffectsPay?: boolean | null;
}

export type UpdateEmployeeInput = Partial<Omit<CreateEmployeeInput, 'empCode'>>;

/** Paging plus the optional search term and filters for the employee list. */
export interface EmployeeListQuery extends PaginationQueryDto {
  search?: string;
  departmentId?: string;
  status?: string;
  jobLevel?: string;
  /** True = linked to an app_user, false = not linked, undefined = no filter. */
  hasAccount?: boolean;
}

/**
 * Employee registry (guarded by EMPLOYEE_MANAGE), company-scoped. A registry record is
 * independent of an app_user account: link/unlink touches only employee.user_id, and
 * resignation expires only the active company's memberships (rbac: Resignation Affects
 * One Company Only). The salary field is masked unless the caller holds EMP_SALARY_VIEW.
 */
@Injectable()
export class EmployeeService {
  constructor(
    private readonly em: EntityManager,
    private readonly passwords: PasswordService,
    private readonly emailVerification: EmailVerificationService,
    private readonly jobLevels: JobLevelService,
  ) {}

  /**
   * A non-empty `job_level` MUST resolve to an active `job_level.code` in the employee's company
   * (job-level capability). Empty/undefined is allowed (no level). Keeps `employee.job_level` and
   * the workflow-step "Engage for levels" condition referencing the same value set, so approval
   * routing can never silently mismatch.
   */
  private async assertJobLevel(
    code: string | undefined,
    companyId: string,
    em: EntityManager,
  ): Promise<void> {
    if (code === undefined || code === '') return;
    const level = await this.jobLevels.resolveActiveByCode(code, companyId, em);
    if (!level) throw new BadRequestException(`Unknown job level '${code}'`);
  }

  private canSeeSalary(): boolean {
    return RequestContext.permissions().includes(RbacPermissions.EMP_SALARY_VIEW);
  }

  private toView(e: Employee, deptName: string): EmployeeView {
    const view: EmployeeView = {
      id: e.id,
      empCode: e.empCode,
      fullName: e.fullName,
      departmentId: e.department.id,
      departmentName: deptName,
      position: e.position,
      jobLevel: e.jobLevel,
      hireDate: e.hireDate,
      status: e.status,
      attendanceRequired: e.attendanceRequired,
      employmentType: e.employmentType,
      attendanceAffectsPay: e.attendanceAffectsPay ?? null,
      userId: e.user?.id,
      hasAccount: !!e.user,
      emailVerified: !!e.user?.emailVerifiedAt,
    };
    // Sensitive: only expose salary when the caller is authorized.
    if (this.canSeeSalary()) view.salary = e.salary;
    return view;
  }

  /**
   * Employees of the active company (paged), optionally narrowed by a search term and filters.
   *
   * The company predicate is written first and is never conditional, so no filter combination
   * can widen what the caller sees — filters may only narrow within the active company. `total`
   * comes from the same `findAndCount`, so the paginator counts the filtered set rather than
   * the whole registry.
   */
  /**
   * Employee picker for the Create Document wizard. Authorized by DOC_CREATE rather than
   * EMPLOYEE_MANAGE and returns selection fields only — the pattern `budgets/selectable` set.
   * A promotion must name the person it promotes, and gating that list behind the HR-admin
   * permission left the required field empty for the role that raises the document.
   */
  async listSelectable(): Promise<Array<{ id: string; empCode: string; fullName: string }>> {
    const companyId = RequestContext.companyId()!;
    const rows = await this.em
      .fork()
      .find(Employee, { company: companyId, status: 'ACTIVE' }, { orderBy: { empCode: 'ASC' }, ...FILTER_OFF });
    return rows.map((e) => ({ id: e.id, empCode: e.empCode, fullName: e.fullName }));
  }

  async list(q: EmployeeListQuery = {}): Promise<Paginated<EmployeeView>> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const { page, limit, offset } = pageParams(q);
    const where: FilterQuery<Employee> = { company: companyId };

    // Empty/whitespace is treated as absent rather than as a match-nothing predicate.
    const term = q.search?.trim();
    if (term) {
      // Any of the three fields may match (OR). `salary` is excluded on purpose: making a
      // permission-gated field searchable would leak its value through result membership.
      where.$or = [
        { empCode: { $ilike: `%${term}%` } },
        { fullName: { $ilike: `%${term}%` } },
        { position: { $ilike: `%${term}%` } },
      ];
    }
    // Filters combine with the term and with each other conjunctively.
    if (q.departmentId) where.department = q.departmentId;
    if (q.status) where.status = q.status;
    if (q.jobLevel) where.jobLevel = q.jobLevel;
    if (q.hasAccount !== undefined) {
      where.user = q.hasAccount ? { $ne: null } : null;
    }

    const [rows, total] = await em.findAndCount(Employee, where, {
      ...FILTER_OFF,
      orderBy: { empCode: 'ASC' },
      offset,
      limit,
      populate: ['user', 'department'],
    });
    const deptById = new Map(
      (await em.find(Department, { company: companyId }, FILTER_OFF)).map((d) => [d.id, d.name]),
    );
    const items = rows.map((e) => this.toView(e, deptById.get(e.department.id) ?? ''));
    return { items, total, page, limit };
  }

  /** One employee in the active company. */
  async get(id: string): Promise<EmployeeView> {
    const e = await this.loadInCompany(this.em.fork(), id);
    const dept = await this.em.fork().findOne(Department, { id: e.department.id }, FILTER_OFF);
    return this.toView(e, dept?.name ?? '');
  }

  /** Create an employee in the active company; emp_code is unique per company. */
  async create(input: CreateEmployeeInput): Promise<EmployeeView> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const dupe = await em.findOne(
      Employee,
      { company: companyId, empCode: input.empCode },
      FILTER_OFF,
    );
    if (dupe) {
      throw new BadRequestException(`Employee code '${input.empCode}' already exists`);
    }
    const dept = await em.findOne(
      Department,
      { id: input.departmentId, company: companyId },
      FILTER_OFF,
    );
    if (!dept) throw new BadRequestException(`Unknown department '${input.departmentId}'`);
    await this.assertJobLevel(input.jobLevel, companyId, em);
    const emp = em.create(Employee, {
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, input.departmentId),
      empCode: input.empCode,
      fullName: input.fullName,
      position: input.position,
      jobLevel: input.jobLevel,
      hireDate: input.hireDate,
      salary: input.salary,
      status: input.status ?? 'ACTIVE',
      attendanceRequired: input.attendanceRequired ?? true,
      employmentType: (input.employmentType as EmploymentType) ?? EmploymentType.MONTHLY,
      // Left undefined when not stated, which is what "inherit the department" looks like.
      attendanceAffectsPay: input.attendanceAffectsPay ?? undefined,
    });
    await em.persistAndFlush(emp);
    return this.toView(emp, dept.name);
  }

  /** Update an employee in the active company (emp_code immutable). */
  async update(id: string, input: UpdateEmployeeInput): Promise<EmployeeView> {
    const companyId = RequestContext.companyId()!;
    const em = this.em.fork();
    const emp = await this.loadInCompany(em, id);
    if (input.departmentId && input.departmentId !== emp.department.id) {
      const dept = await em.findOne(
        Department,
        { id: input.departmentId, company: companyId },
        FILTER_OFF,
      );
      if (!dept) throw new BadRequestException(`Unknown department '${input.departmentId}'`);
      emp.department = dept;
    }
    if (input.fullName !== undefined) emp.fullName = input.fullName;
    if (input.position !== undefined) emp.position = input.position;
    if (input.jobLevel !== undefined) {
      await this.assertJobLevel(input.jobLevel, companyId, em);
      emp.jobLevel = input.jobLevel;
    }
    if (input.hireDate !== undefined) emp.hireDate = input.hireDate;
    if (input.salary !== undefined) emp.salary = input.salary;
    if (input.status !== undefined) emp.status = input.status;
    if (input.attendanceRequired !== undefined) emp.attendanceRequired = input.attendanceRequired;
    if (input.employmentType !== undefined) {
      emp.employmentType = input.employmentType as EmploymentType;
    }
    // null clears the override and returns the employee to inheriting their department.
    if (input.attendanceAffectsPay !== undefined) {
      emp.attendanceAffectsPay = input.attendanceAffectsPay ?? undefined;
    }
    await em.flush();
    const deptName = (await em.findOne(Department, { id: emp.department.id }, FILTER_OFF))?.name ?? '';
    return this.toView(emp, deptName);
  }

  /**
   * Login accounts not yet linked to any employee, for the "link existing account" picker
   * (guarded by EMPLOYEE_MANAGE). Because Employee.user is a unique one-to-one, an account
   * linked to an employee in ANY company is excluded. Returns identity only — no password,
   * status, or per-company assignments — so no company data crosses. An optional case-insensitive
   * search filters username/email; results are capped so large tenants stay responsive.
   */
  async listLinkableAccounts(search?: string): Promise<LinkableAccount[]> {
    const em = this.em.fork();
    const linked = await em.find(Employee, { user: { $ne: null } }, { ...FILTER_OFF, fields: ['user'] });
    const linkedIds = linked.map((e) => e.user!.id);
    // Service accounts are never offered: this picker exists to attach a PERSON's login to their
    // employee record, and a bot in it invites a fake employee row for something that is not a
    // person. Excluded regardless of link state.
    const where: Record<string, unknown> = { isServiceAccount: false };
    if (linkedIds.length) where.id = { $nin: linkedIds };
    const term = search?.trim();
    if (term) {
      where.$or = [
        { username: { $ilike: `%${term}%` } },
        { email: { $ilike: `%${term}%` } },
      ];
    }
    const users = await em.find(AppUser, where, { orderBy: { username: 'ASC' }, limit: 50 });
    return users.map((u) => ({ id: u.id, username: u.username, email: u.email }));
  }

  /** Link an employee to a login account: sets ONLY employee.user_id. */
  async link(id: string, userId: string): Promise<EmployeeView> {
    const em = this.em.fork();
    const emp = await this.loadInCompany(em, id);
    const user = await em.findOne(AppUser, { id: userId });
    if (!user) throw new BadRequestException(`Unknown user '${userId}'`);
    emp.user = user;
    await em.flush();
    const deptName = (await em.findOne(Department, { id: emp.department.id }, FILTER_OFF))?.name ?? '';
    return this.toView(emp, deptName);
  }

  /**
   * Create a login account and link it to the employee in one atomic step. The admin never
   * supplies a password: the initial password is read from USER_PASSWORD (server env) and stored
   * only as a one-way hash. New accounts are ACTIVE. Rejects when the employee already has an
   * account, when username/email collide (DB unique constraint is authoritative), or when
   * USER_PASSWORD is not configured (fail closed — no default/empty password).
   */
  async createAccount(
    id: string,
    input: { username: string; email: string },
  ): Promise<EmployeeView> {
    const initialPassword = process.env.USER_PASSWORD;
    if (!initialPassword) {
      throw new BadRequestException('USER_PASSWORD is not configured');
    }
    const passwordHash = await this.passwords.hash(initialPassword);
    let createdUser: AppUser | undefined;
    const view = await this.em.transactional(async (em) => {
      const emp = await this.loadInCompany(em, id);
      if (emp.user) {
        throw new BadRequestException('Employee already has a linked account');
      }
      const user = em.create(AppUser, {
        username: input.username,
        email: input.email,
        passwordHash,
        status: 'ACTIVE',
      });
      emp.user = user;
      try {
        await em.flush();
      } catch (e) {
        if (e instanceof UniqueConstraintViolationException) {
          throw new BadRequestException('Username or email already in use');
        }
        throw e;
      }
      createdUser = user;
      const deptName =
        (await em.findOne(Department, { id: emp.department.id }, FILTER_OFF))?.name ?? '';
      return this.toView(emp, deptName);
    });
    // Best-effort verification email after the account is committed (never fails creation).
    if (createdUser) await this.emailVerification.sendVerification(createdUser);
    return view;
  }

  /**
   * Onboard an employee in one atomic step (guarded by EMPLOYEE_MANAGE + RBAC_MANAGE): create the
   * login account, link it, AND grant a first company-role assignment in the ACTIVE company. The
   * membership is created as the user's default company (isDefault: true) so login auto-selects it
   * and issues a token — closing the "account with no company access" footgun. Company comes from
   * context, never the body; role and department are validated against the active company. As with
   * createAccount, the password is set server-side from USER_PASSWORD and the account is ACTIVE.
   * Rejects (persisting nothing) when the employee already has an account, when username/email
   * collide, when the role/department is not in the active company, or when USER_PASSWORD is unset.
   */
  async onboard(
    id: string,
    input: {
      username: string;
      email: string;
      roleId: string;
      departmentId: string;
      validFrom?: string;
      validTo?: string;
    },
  ): Promise<EmployeeView> {
    const companyId = RequestContext.companyId()!;
    const initialPassword = process.env.USER_PASSWORD;
    if (!initialPassword) {
      throw new BadRequestException('USER_PASSWORD is not configured');
    }
    const passwordHash = await this.passwords.hash(initialPassword);
    let createdUser: AppUser | undefined;
    const view = await this.em.transactional(async (em) => {
      const emp = await this.loadInCompany(em, id);
      if (emp.user) {
        throw new BadRequestException('Employee already has a linked account');
      }
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
        passwordHash,
        status: 'ACTIVE',
      });
      emp.user = user;
      // Default membership → login auto-selects this company and issues a token.
      em.create(UserCompanyRole, {
        user,
        company: em.getReference(Company, companyId),
        department: dept,
        role,
        isDefault: true,
        validFrom: input.validFrom,
        validTo: input.validTo,
      });
      try {
        await em.flush();
      } catch (e) {
        if (e instanceof UniqueConstraintViolationException) {
          throw new BadRequestException('Username or email already in use');
        }
        throw e;
      }
      createdUser = user;
      return this.toView(emp, dept.name);
    });
    // Best-effort verification email after the account is committed (never fails onboarding).
    if (createdUser) await this.emailVerification.sendVerification(createdUser);
    return view;
  }

  /**
   * Admin manual email-verification (guarded by EMPLOYEE_MANAGE): mark the employee's linked account
   * verified without sending or requiring an email — the escape hatch when verification mail cannot be
   * delivered. Idempotent and one-way (never un-verifies); rejects when the employee has no account.
   */
  async verifyAccount(id: string): Promise<EmployeeView> {
    const em = this.em.fork();
    const emp = await this.loadInCompany(em, id);
    if (!emp.user) throw new BadRequestException('Employee has no linked account');
    await this.emailVerification.markVerified(emp.user.id);
    const dept = await em.findOne(Department, { id: emp.department.id }, FILTER_OFF);
    // Re-load so the view reflects the just-set verification timestamp.
    const fresh = await this.loadInCompany(em.fork(), id);
    return this.toView(fresh, dept?.name ?? '');
  }

  /** Unlink an employee from its account: clears ONLY employee.user_id. */
  async unlink(id: string): Promise<EmployeeView> {
    const em = this.em.fork();
    const emp = await this.loadInCompany(em, id);
    emp.user = undefined;
    await em.flush();
    const deptName = (await em.findOne(Department, { id: emp.department.id }, FILTER_OFF))?.name ?? '';
    return this.toView(emp, deptName);
  }

  /**
   * Apply a promotion to an employee within a caller-supplied transaction and company scope.
   * Only the provided fields change; `salary` is a decimal string; `emp_code`/company immutable.
   * Reused by the manual admin edit and the UPDATE_EMPLOYEE post-action.
   */
  async applyPromotion(
    employeeId: string,
    changes: { position?: string; salary?: string; jobLevel?: string },
    companyId: string,
    em: EntityManager,
  ): Promise<void> {
    const emp = await this.loadInCompanyScoped(em, employeeId, companyId);
    if (changes.position !== undefined) emp.position = changes.position;
    if (changes.jobLevel !== undefined) {
      await this.assertJobLevel(changes.jobLevel, companyId, em);
      emp.jobLevel = changes.jobLevel;
    }
    if (changes.salary !== undefined) emp.salary = changes.salary;
    await em.flush();
  }

  /**
   * Apply a resignation within a caller-supplied transaction and company scope: set
   * status=RESIGNED and expire the linked user's memberships in THIS company only, with
   * `valid_to = effectiveDate` (default immediate/yesterday when none). The shared app_user and
   * other companies are untouched. Reused by the manual admin action and the
   * TERMINATE_EMPLOYEE post-action.
   */
  async applyResignation(
    employeeId: string,
    effectiveDate: string | undefined,
    companyId: string,
    em: EntityManager,
  ): Promise<{ status: string; expired: number }> {
    const validTo = effectiveDate ?? EmployeeService.yesterday();
    const emp = await this.loadInCompanyScoped(em, employeeId, companyId);
    emp.status = 'RESIGNED';
    let expired = 0;
    if (emp.user) {
      const memberships = await em.find(UserCompanyRole, { user: emp.user.id, company: companyId }, FILTER_OFF);
      for (const m of memberships) {
        m.validTo = validTo;
        expired++;
      }
    }
    await em.flush();
    return { status: emp.status, expired };
  }

  /** Yesterday (UTC, ISO date) — resolution excludes memberships with valid_to < today. */
  private static yesterday(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Mark resigned: set status=RESIGNED and expire the linked user's memberships in THIS
   * company only — atomically. The shared app_user and other companies are untouched.
   */
  async resign(id: string): Promise<{ status: string; expired: number }> {
    const companyId = RequestContext.companyId()!;
    return this.em.fork().transactional((em) => this.applyResignation(id, undefined, companyId, em));
  }

  /** Load an employee and assert it belongs to the active company. */
  private loadInCompany(em: EntityManager, id: string): Promise<Employee> {
    return this.loadInCompanyScoped(em, id, RequestContext.companyId()!);
  }

  /** Load an employee and assert it belongs to the given company (no RequestContext). */
  private async loadInCompanyScoped(em: EntityManager, id: string, companyId: string): Promise<Employee> {
    const emp = await em.findOne(Employee, { id }, { ...FILTER_OFF, populate: ['user', 'department'] });
    if (!emp || emp.company.id !== companyId) {
      throw new NotFoundException(`Employee ${id} not found`);
    }
    return emp;
  }
}
