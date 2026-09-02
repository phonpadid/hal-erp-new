import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { ForbiddenException, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { WarehouseController } from '../inventory/warehouse.controller';
import { EmployeeController } from '../rbac/employee.controller';
import { EmployeeService } from '../rbac/employee.service';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { Warehouse } from '../inventory/inventory.entities';
import { WarehouseService } from '../inventory/warehouse.service';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The wizard's warehouse and employee pickers read endpoints the document-raising role could not
 * call — `INV_VIEW` and `EMPLOYEE_MANAGE`. Both loads fail soft, so the required field rendered as
 * an empty dropdown and the document could never be submitted. These reads are the narrow
 * `DOC_CREATE` alternative, the shape `budgets/selectable` and `quotas/selectable` already use.
 */
describe.skipIf(!hasDb)('requester-facing picker reads (DB-backed)', () => {
  let orm: MikroORM;
  let warehouses: WarehouseService;
  let employees: EmployeeService;
  let companyA = '';
  let companyB = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;

    // A second company with its own warehouse, so company scoping is actually exercised.
    const other = em.create(Company, {
      code: 'OTHER', nameTh: 'Other', taxId: '9', branchCode: '00000',
      baseCurrency: em.getReference(Company, companyA).baseCurrency, isActive: true,
    } as never);
    await em.flush();
    companyB = other.id;
    em.create(Warehouse, { company: other, code: 'FAR', name: 'Far store', isActive: true } as never);
    // An inactive warehouse in the active company: a picker must not offer it.
    em.create(Warehouse, { company: em.getReference(Company, companyA), code: 'OLD', name: 'Closed', isActive: false } as never);
    await em.flush();

    warehouses = new WarehouseService(new CompanyScopeService(orm.em));
    // listSelectable only needs the EM; the rest of the service's deps are not exercised here.
    employees = new EmployeeService(orm.em, null as never, null as never, null as never);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('offers only this company\'s active warehouses, with selection fields only', async () => {
    const rows = await asA(() => warehouses.listSelectable());
    const codes = rows.map((w) => w.code).sort();
    expect(codes).toContain('MAIN');
    // Another company's warehouse (invariant 1) and a deactivated one are both absent.
    expect(codes).not.toContain('FAR');
    expect(codes).not.toContain('OLD');
    // No stock figures ride along — the picker needs a name, not a balance.
    expect(Object.keys(rows[0]).sort()).toEqual(['code', 'id', 'name']);
  });

  it('offers only this company\'s active employees, with selection fields only', async () => {
    const em = orm.em.fork();
    const deptA = await em.findOneOrFail(Department, { company: companyA }, FILTER_OFF);
    const deptB = em.create(Department, {
      company: em.getReference(Company, companyB), deptCode: 'D-FAR', name: 'Far dept',
    } as never);
    await em.flush();

    // A resigned employee in this company and an active one in another: neither may be offered.
    em.create(Employee, {
      company: em.getReference(Company, companyA), department: deptA,
      empCode: 'E-GONE', fullName: 'Left', status: 'RESIGNED',
    } as never);
    em.create(Employee, {
      company: em.getReference(Company, companyB), department: deptB,
      empCode: 'E-FAR', fullName: 'Elsewhere', status: 'ACTIVE',
    } as never);
    await em.flush();

    const rows = await asA(() => employees.listSelectable());
    const codes = rows.map((e) => e.empCode);
    expect(codes).toContain('EMP-REQ');
    expect(codes).not.toContain('E-GONE');
    expect(codes).not.toContain('E-FAR');
    // No salary, no job level, no employment history — a picker needs a name.
    expect(Object.keys(rows[0]).sort()).toEqual(['empCode', 'fullName', 'id']);
  });

  /**
   * Runs the real guard over the real controllers. The requester's actual grant, taken from the
   * seed: no INV_VIEW, no EMPLOYEE_MANAGE. D7 rests on `getAllAndOverride([handler, class])`
   * letting a handler-level DOC_CREATE *replace* the class-level EMPLOYEE_MANAGE rather than add
   * to it — if that were `getAllAndMerge`, the employee read would need both and stay refused.
   */
  it('lets DOC_CREATE alone through the selection reads, and still refuses the admin lists', () => {
    const guard = new PermissionsGuard(new Reflector());
    const call = (cls: Type<unknown>, method: string, codes: string[]) =>
      guard.canActivate({
        getHandler: () => (cls.prototype as Record<string, never>)[method],
        getClass: () => cls,
        switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes: codes } }) }),
      } as never);

    const REQUESTER = ['DOC_VIEW', 'DOC_CREATE', 'DOC_SUBMIT', 'DOC_CANCEL'];

    expect(call(WarehouseController, 'listSelectable', REQUESTER)).toBe(true);
    expect(call(EmployeeController, 'listSelectable', REQUESTER)).toBe(true);

    // The administration lists are untouched by this change and stay shut to the same caller.
    expect(() => call(WarehouseController, 'list', REQUESTER)).toThrow(ForbiddenException);
    expect(() => call(EmployeeController, 'list', REQUESTER)).toThrow(ForbiddenException);

    // And the selection reads are not open house: drop DOC_CREATE and both close.
    const NO_CREATE = REQUESTER.filter((c) => c !== 'DOC_CREATE');
    expect(() => call(WarehouseController, 'listSelectable', NO_CREATE)).toThrow(ForbiddenException);
    expect(() => call(EmployeeController, 'listSelectable', NO_CREATE)).toThrow(ForbiddenException);
  });

  it('declares those gates on the handlers themselves', () => {
    // Read off the decorators, so a later edit that widens or narrows either one fails here.
    const perms = (target: object, method?: string) =>
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        method ? (target as Record<string, never>)[method] : target,
      ) as string[] | undefined;

    expect(perms(WarehouseController.prototype, 'listSelectable')).toEqual(['DOC_CREATE']);
    expect(perms(WarehouseController.prototype, 'list')).toEqual(['INV_VIEW']);

    expect(perms(EmployeeController.prototype, 'listSelectable')).toEqual(['DOC_CREATE']);
    // The employee controller gates at class level; the handler above overrides only itself.
    expect(perms(EmployeeController)).toEqual(['EMPLOYEE_MANAGE']);
    expect(perms(EmployeeController.prototype, 'list')).toBeUndefined();
  });
});
