import { PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY } from '../../auth/require-permissions.decorator';
import { EmployeeController } from './employee.controller';
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
