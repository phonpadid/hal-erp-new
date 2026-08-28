import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ForbiddenException, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { BudgetController } from './budget.controller';
import { DepartmentController } from '../multi-company/department.controller';
import { FiscalYearController } from '../multi-company/fiscal-year.controller';

/**
 * The same permission trap as `budget-filter-departments-gate`, caught a second time on the screen
 * next door — and this time in production rather than in review.
 *
 * The budget CREATE form read its fiscal years from `GET /fiscal-years` (`FISCAL_YEAR_MANAGE`) and
 * its departments from `GET /departments` (`DEPARTMENT_VIEW`). `LATTANAPHONE` is the company's
 * budget officer: `BUDGET_MANAGE`, `BUDGET_VIEW`, `COA_VIEW`, `DOC_*`, `MASTER_VIEW`,
 * `NOTIFICATION_VIEW`, `QUOTA_VIEW`, `REPORT_VIEW` — and neither of those two. Both reads answered
 * 403, so the form built for them was the one screen they could not use, while `admin` — who holds
 * every code — could never see it.
 *
 * These run the REAL guard over the REAL controllers with that user's REAL permission set, which is
 * the only way to demonstrate a lockout a developer account cannot reproduce.
 */
describe('the reads a budget proposal needs: the gate', () => {
  const guard = new PermissionsGuard(new Reflector());
  const call = (cls: Type<unknown>, method: string, codes: string[]) =>
    guard.canActivate({
      getHandler: () => (cls.prototype as Record<string, never>)[method],
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes: codes } }) }),
    } as never);

  /** LATTANAPHONE's actual grants, copied from the customer database. */
  const BUDGET_OFFICER = [
    'BUDGET_MANAGE', 'BUDGET_VIEW', 'COA_VIEW', 'DOC_APPROVE', 'DOC_BACKDATE', 'DOC_CANCEL',
    'DOC_CREATE', 'DOC_RECEIVE', 'DOC_SUBMIT', 'DOC_VIEW', 'MASTER_VIEW', 'NOTIFICATION_VIEW',
    'QUOTA_VIEW', 'REPORT_VIEW',
  ];

  it('lets the budget officer read the fiscal years to propose against', () => {
    expect(call(BudgetController, 'selectableFiscalYears', BUDGET_OFFICER)).toBe(true);
  });

  it('lets the budget officer read the departments to propose for', () => {
    expect(call(BudgetController, 'selectableDepartments', BUDGET_OFFICER)).toBe(true);
  });

  it('refuses that same officer both directory reads the form used to use', () => {
    // Not hypothetical: this pair of refusals is what emptied the form. Asserted so that a later
    // edit which points the pickers back at the directory fails here, loudly, instead of in the
    // browser of someone who cannot report what they are not seeing.
    expect(() => call(FiscalYearController, 'list', BUDGET_OFFICER)).toThrow(ForbiddenException);
    expect(() => call(DepartmentController, 'list', BUDGET_OFFICER)).toThrow(ForbiddenException);
  });

  it('does not open either read to a caller without BUDGET_MANAGE', () => {
    const NO_MANAGE = BUDGET_OFFICER.filter((c) => c !== 'BUDGET_MANAGE');
    expect(() => call(BudgetController, 'selectableFiscalYears', NO_MANAGE)).toThrow(ForbiddenException);
    expect(() => call(BudgetController, 'selectableDepartments', NO_MANAGE)).toThrow(ForbiddenException);
  });

  it('declares each gate on the handler itself, matching the act it serves', () => {
    const perms = (target: object, method: string) =>
      Reflect.getMetadata(PERMISSIONS_KEY, (target as Record<string, never>)[method]) as
        | string[]
        | undefined;

    // The same code that authorizes proposing. That equality IS the requirement, so it is asserted
    // rather than assumed.
    expect(perms(BudgetController.prototype, 'selectableFiscalYears')).toEqual(['BUDGET_MANAGE']);
    expect(perms(BudgetController.prototype, 'selectableDepartments')).toEqual(['BUDGET_MANAGE']);
    expect(perms(BudgetController.prototype, 'propose')).toEqual(['BUDGET_MANAGE']);
  });
});
