/** Permission CODES owned by the rbac capability. */
export const RbacPermissions = {
  RBAC_MANAGE: 'RBAC_MANAGE',
  // Employee registry: manage records, link/unlink accounts, resignation.
  EMPLOYEE_MANAGE: 'EMPLOYEE_MANAGE',
  // Sensitive salary field: read access is gated by this code (DBML note on employee.salary).
  EMP_SALARY_VIEW: 'EMP_SALARY_VIEW',
} as const;
