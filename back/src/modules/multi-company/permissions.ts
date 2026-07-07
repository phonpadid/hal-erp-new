/**
 * Permission CODES for the multi-company capability. Authorization is always on
 * these codes, never role names (invariant 6). rbac will own seeding/issuance;
 * the guard reads them from the JWT.
 */
export const MultiCompanyPermissions = {
  COMPANY_VIEW: 'COMPANY_VIEW',
  COMPANY_MANAGE: 'COMPANY_MANAGE',
  DEPARTMENT_VIEW: 'DEPARTMENT_VIEW',
  DEPARTMENT_MANAGE: 'DEPARTMENT_MANAGE',
  FISCAL_YEAR_MANAGE: 'FISCAL_YEAR_MANAGE',
  HOLIDAY_MANAGE: 'HOLIDAY_MANAGE',
} as const;
