import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ForbiddenException, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { BudgetController } from './budget.controller';
import { DepartmentController } from '../multi-company/department.controller';

/**
 * The permission trap this change exists to avoid.
 *
 * The budget list's department filter needs a list of departments. The obvious source is
 * `GET /departments` — and that requires `DEPARTMENT_VIEW`, which a holder of `BUDGET_VIEW` need
 * not have. Sourcing the dropdown there would hand an empty filter to exactly the department heads
 * the filter is for, and the failure would be invisible: an empty `Select`, no error, nothing to
 * report.
 *
 * So the options come from a read gated with the budget list itself. These run the REAL guard over
 * the REAL controllers to prove that a `BUDGET_VIEW`-only caller gets them — the one thing a
 * developer account, which holds every code, can never demonstrate.
 */
describe('budget filter departments: the gate', () => {
  const guard = new PermissionsGuard(new Reflector());
  const call = (cls: Type<unknown>, method: string, codes: string[]) =>
    guard.canActivate({
      getHandler: () => (cls.prototype as Record<string, never>)[method],
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes: codes } }) }),
    } as never);

  /** A department head who may read budgets and is not an org administrator. */
  const BUDGET_READER = ['BUDGET_VIEW', 'DOC_VIEW', 'DOC_CREATE'];

  it('lets a budget reader fetch the filter options', () => {
    expect(call(BudgetController, 'filterDepartments', BUDGET_READER)).toBe(true);
  });

  it('refuses that same reader the department directory', () => {
    // The read this change deliberately does NOT use. If it ever became the source, this caller
    // would see an empty filter and no explanation.
    expect(() => call(DepartmentController, 'list', BUDGET_READER)).toThrow(ForbiddenException);
  });

  it('does not open the filter options to a caller without BUDGET_VIEW', () => {
    const NO_BUDGET = BUDGET_READER.filter((c) => c !== 'BUDGET_VIEW');
    expect(() => call(BudgetController, 'filterDepartments', NO_BUDGET)).toThrow(ForbiddenException);
  });

  it('declares the gate on the handler itself', () => {
    // Read off the decorator, so a later edit that widens or narrows it fails here rather than in
    // a browser belonging to someone who cannot report what they are not seeing.
    const perms = (target: object, method: string) =>
      Reflect.getMetadata(PERMISSIONS_KEY, (target as Record<string, never>)[method]) as
        | string[]
        | undefined;

    expect(perms(BudgetController.prototype, 'filterDepartments')).toEqual(['BUDGET_VIEW']);
    // Same gate as the list it serves — that is the whole point, so it is asserted, not assumed.
    expect(perms(BudgetController.prototype, 'list')).toEqual(['BUDGET_VIEW']);
    expect(perms(DepartmentController.prototype, 'list')).toEqual(['DEPARTMENT_VIEW']);
  });
});
