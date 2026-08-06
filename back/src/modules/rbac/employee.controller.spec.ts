import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { EmployeeController } from './employee.controller';
import { ListEmployeesQueryDto } from './dto/employee.dto';
import { EmployeeService } from './employee.service';
import { RbacPermissions as P } from './permissions';

// Lightweight controller wiring checks (no DB): the linkable-accounts read is guarded by
// EMPLOYEE_MANAGE, is a STATIC route (so it is not captured by GET :id), and delegates its
// search param to the service. The generic PermissionsGuard behaviour is covered separately.
describe('EmployeeController — linkable-accounts route', () => {
  it('the whole controller requires EMPLOYEE_MANAGE (so the read is not open)', () => {
    const codes = Reflect.getMetadata(PERMISSIONS_KEY, EmployeeController);
    expect(codes).toContain(P.EMPLOYEE_MANAGE);
  });

  it('is a static "linkable-accounts" path, so GET :id cannot shadow it', () => {
    const path = Reflect.getMetadata(PATH_METADATA, EmployeeController.prototype.linkableAccounts);
    expect(path).toBe('linkable-accounts');
    // Contrast: get() is the param route it must precede.
    const idPath = Reflect.getMetadata(PATH_METADATA, EmployeeController.prototype.get);
    expect(idPath).toBe(':id');
    // Declaration order: linkableAccounts is defined before get on the prototype.
    const names = Object.getOwnPropertyNames(EmployeeController.prototype);
    expect(names.indexOf('linkableAccounts')).toBeLessThan(names.indexOf('get'));
  });

  it('delegates the search query to the service', () => {
    const calls: Array<string | undefined> = [];
    const service = { listLinkableAccounts: (s?: string) => (calls.push(s), []) } as unknown as EmployeeService;
    const controller = new EmployeeController(service);
    controller.linkableAccounts('alice');
    controller.linkableAccounts();
    expect(calls).toEqual(['alice', undefined]);
  });
});

describe('EmployeeController — onboard route', () => {
  it('requires BOTH EMPLOYEE_MANAGE and RBAC_MANAGE (method-level overrides the class default)', () => {
    const codes = Reflect.getMetadata(PERMISSIONS_KEY, EmployeeController.prototype.onboard);
    expect(codes).toContain(P.EMPLOYEE_MANAGE);
    expect(codes).toContain(P.RBAC_MANAGE);
    expect(codes).toHaveLength(2);
  });

  it('is a POST ":id/onboard" route', () => {
    const path = Reflect.getMetadata(PATH_METADATA, EmployeeController.prototype.onboard);
    expect(path).toBe(':id/onboard');
  });

  it('delegates to the service with id and dto', () => {
    const calls: Array<{ id: string; dto: unknown }> = [];
    const service = { onboard: (id: string, dto: unknown) => (calls.push({ id, dto }), {}) } as unknown as EmployeeService;
    const controller = new EmployeeController(service);
    const dto = { username: 'u', email: 'u@x', roleId: 'r', departmentId: 'd' };
    controller.onboard('emp-1', dto as never);
    expect(calls).toEqual([{ id: 'emp-1', dto }]);
  });
});

/**
 * The list query contract lives in the DTO, so it is provable without a database. A malformed
 * filter must be REJECTED, not ignored: ignoring it returns the full list, which reads as a
 * legitimate answer while not being the one that was asked for.
 */
describe('ListEmployeesQueryDto', () => {
  const q = (over: Record<string, unknown>) => plainToInstance(ListEmployeesQueryDto, over);
  const UUID = '11111111-1111-4111-8111-111111111111';

  it('accepts an empty query — every parameter is optional', async () => {
    expect(await validate(q({}))).toHaveLength(0);
  });

  it('accepts a full set of valid search and filter params', async () => {
    const dto = q({
      page: '2',
      limit: '50',
      search: 'alice',
      departmentId: UUID,
      status: 'RESIGNED',
      jobLevel: 'MANAGER',
      hasAccount: 'true',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.hasAccount).toBe(true);
  });

  it('coerces hasAccount from the query string, leaving absent as undefined', async () => {
    expect(q({ hasAccount: 'true' }).hasAccount).toBe(true);
    expect(q({ hasAccount: 'false' }).hasAccount).toBe(false);
    // Absent means "no filter" — it must not collapse to false, or "not linked" and
    // "not filtered" would become the same request.
    expect(q({}).hasAccount).toBeUndefined();
    expect(q({ hasAccount: '' }).hasAccount).toBeUndefined();
  });

  it('rejects a status outside ACTIVE / RESIGNED / TERMINATED', async () => {
    const errors = await validate(q({ status: 'FIRED' }));
    expect(errors.map((e) => e.property)).toEqual(['status']);
  });

  it('rejects a departmentId that is not a UUID', async () => {
    const errors = await validate(q({ departmentId: 'not-a-uuid' }));
    expect(errors.map((e) => e.property)).toEqual(['departmentId']);
  });

  it('rejects a search term longer than the bound', async () => {
    expect(await validate(q({ search: 'a'.repeat(100) }))).toHaveLength(0);
    expect(await validate(q({ search: 'a'.repeat(101) }))).toHaveLength(1);
  });
});

describe('EmployeeController — verify-account route', () => {
  it('inherits the class EMPLOYEE_MANAGE guard (no method-level override → not RBAC_MANAGE)', () => {
    // No method-level metadata; the class-level guard (EMPLOYEE_MANAGE) applies.
    const methodCodes = Reflect.getMetadata(PERMISSIONS_KEY, EmployeeController.prototype.verifyAccount);
    expect(methodCodes).toBeUndefined();
    const classCodes = Reflect.getMetadata(PERMISSIONS_KEY, EmployeeController);
    expect(classCodes).toEqual([P.EMPLOYEE_MANAGE]);
  });

  it('is a POST ":id/verify-account" route that delegates to the service', () => {
    const path = Reflect.getMetadata(PATH_METADATA, EmployeeController.prototype.verifyAccount);
    expect(path).toBe(':id/verify-account');
    const calls: string[] = [];
    const service = { verifyAccount: (id: string) => (calls.push(id), {}) } as unknown as EmployeeService;
    new EmployeeController(service).verifyAccount('emp-9');
    expect(calls).toEqual(['emp-9']);
  });
});
