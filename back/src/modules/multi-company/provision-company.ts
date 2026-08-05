import { Scope } from '../../common/enums';
import { Permission, Role, RolePermission, UserCompanyRole, type AppUser } from '../rbac/rbac.entities';
import { ReportingPermissions } from '../reporting/permissions';
import { Company, Department } from './multi-company.entities';
import type { Currency } from '../currency/currency.entities';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * What a company needs in order to be reachable by the person who created it.
 *
 * A `company` row on its own is unusable: `switchCompany` resolves an active `user_company_role`,
 * that row needs a role and a department, and the role is worth nothing without the
 * `role_permission` rows carrying its codes (invariant 6 — authorize on codes, never role names).
 * So "create a company" is really six tables, and the shape of those six is a rule, not an
 * implementation detail.
 *
 * It lives here rather than inside `CompanyService` because there are two callers with the same
 * need and no way to share the service: the company-admin endpoint, and the production bootstrap,
 * which runs before any account exists and so cannot go through an authenticated request. Two
 * copies of this rule would drift the moment a permission needs a scope other than COMPANY, and
 * the drift would be silent — an administrator seeing the wrong slice of data, not an error.
 *
 * The caller owns the transaction. Every row here must commit or none of them, but this function
 * is not the one that decides where that boundary is.
 */
export interface ProvisionCompanyInput {
  code: string;
  nameTh: string;
  nameEn?: string;
  taxId?: string;
  branchCode?: string;
  timezone?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  /** Already resolved and already known to be active — this function does not look currencies up. */
  baseCurrency: Currency;
  /** The account whose membership makes the company reachable. Omitted only where none exists yet. */
  creator?: AppUser;
  /**
   * Whether the creator's membership is their default company. Login auto-selects a default and
   * otherwise auto-selects only when the account belongs to exactly one company, so the first
   * membership of a first account wants this true.
   */
  isDefault?: boolean;
}

export interface ProvisionedCompany {
  company: Company;
  adminRole: Role;
  department: Department;
  /** How many permission codes the ADMIN role was granted — the catalog's size at this moment. */
  grants: number;
}

export async function provisionCompany(
  em: EntityManager,
  input: ProvisionCompanyInput,
): Promise<ProvisionedCompany> {
  const company = em.create(Company, {
    code: input.code,
    nameTh: input.nameTh,
    nameEn: input.nameEn,
    taxId: input.taxId,
    // Head office. Carried explicitly rather than left to the column default: the entity does not
    // list it as optional, so an omitted value is a type error at every call site instead.
    branchCode: input.branchCode ?? '00000',
    baseCurrency: input.baseCurrency,
    // Defines when this company's calendar days begin and end. The shared schema defaults it
    // to Asia/Bangkok, so a caller that omits it still gets a usable zone rather than UTC.
    timezone: input.timezone,
    // Letterhead contact block (optional) — stamped at creation, editable later.
    address: input.address,
    phone: input.phone,
    email: input.email,
    website: input.website,
    isActive: true,
    createdAt: new Date(),
  });
  em.persist(company);

  // ADMIN role granted every active permission (authorize on codes, invariant 6).
  const adminRole = em.create(Role, { company, code: 'ADMIN', name: 'Administrator', isActive: true });
  em.persist(adminRole);
  const permissions = await em.find(Permission, { isActive: true });
  for (const permission of permissions) {
    // Group-consolidated reporting is meaningful only at GROUP scope; the rest is COMPANY-wide.
    const scope =
      permission.code === ReportingPermissions.REPORT_GROUP_VIEW ? Scope.GROUP : Scope.COMPANY;
    em.persist(em.create(RolePermission, { role: adminRole, permission, scope }));
  }

  // A default department so the membership (and later employees) have somewhere to live.
  const department = em.create(Department, {
    company,
    deptCode: 'HQ',
    name: 'Head Office',
    isActive: true,
  });
  em.persist(department);

  // The creator's membership — the row switchCompany resolves. Skipped only where no account
  // exists to attach it to.
  if (input.creator) {
    em.persist(
      em.create(UserCompanyRole, {
        user: input.creator,
        company,
        department,
        role: adminRole,
        isDefault: input.isDefault ?? false,
      }),
    );
  }

  return { company, adminRole, department, grants: permissions.length };
}
