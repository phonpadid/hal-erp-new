import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { companyCreateSchema } from '@erp/shared';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { EmploymentType } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { RbacPermissions } from '../rbac/permissions';
import { EmployeeService } from '../rbac/employee.service';
import { JobLevelService } from '../job-level/job-level.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe('company timezone schema', () => {
  const valid = { code: 'C1', nameTh: 'บริษัท', branchCode: '00000', baseCurrency: 'THB' };

  it('defaults to Asia/Bangkok when a caller omits it', () => {
    expect(companyCreateSchema.parse(valid).timezone).toBe('Asia/Bangkok');
  });

  it('accepts an IANA zone name', () => {
    expect(companyCreateSchema.parse({ ...valid, timezone: 'Asia/Vientiane' }).timezone).toBe('Asia/Vientiane');
  });

  it('rejects a zone the runtime does not recognise', () => {
    expect(companyCreateSchema.safeParse({ ...valid, timezone: 'Nowhere/Here' }).success).toBe(false);
  });

  it('rejects a fixed offset, which cannot follow a DST rule', () => {
    expect(companyCreateSchema.safeParse({ ...valid, timezone: '+07:00' }).success).toBe(false);
  });
});

describe.skipIf(!hasDb)('employee attendance fields (DB-backed)', () => {
  let orm: MikroORM;
  let employees: EmployeeService;
  let companyA = '';
  let deptA = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    // A real JobLevelService rather than a stub: create() validates job_level through it, so a
    // null here would pass only because these fixtures happen not to set one.
    employees = new EmployeeService(
      orm.em,
      null as never,
      null as never,
      new JobLevelService(orm.em, new CompanyScopeService(orm.em)),
    );
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const d = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    await em.flush();
    companyA = a.id; deptA = d.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run(
      { companyId: companyA, grants: [{ code: RbacPermissions.EMPLOYEE_MANAGE, scope: 'COMPANY' }] as never },
      fn,
    );

  it('defaults a new employee to attendance-required and monthly pay', async () => {
    const view = await asA(() =>
      employees.create({ empCode: `E${seq++}`, fullName: 'Somchai', departmentId: deptA }),
    );
    expect(view.attendanceRequired).toBe(true);
    expect(view.employmentType).toBe(EmploymentType.MONTHLY);
  });

  it('records a daily-paid employee', async () => {
    const view = await asA(() =>
      employees.create({
        empCode: `E${seq++}`,
        fullName: 'Daily',
        departmentId: deptA,
        employmentType: EmploymentType.DAILY,
      }),
    );
    expect(view.employmentType).toBe(EmploymentType.DAILY);
  });

  /**
   * An exempt employee is excluded from absence reporting, but the flag gates reporting, not
   * writing — attendance recorded for them must still be storable.
   */
  it('exempts an employee from attendance without hiding them', async () => {
    const view = await asA(() =>
      employees.create({
        empCode: `E${seq++}`,
        fullName: 'Executive',
        departmentId: deptA,
        attendanceRequired: false,
      }),
    );
    expect(view.attendanceRequired).toBe(false);

    const em = orm.em.fork();
    const stored = await em.findOne(Employee, { id: view.id }, FILTER_OFF);
    expect(stored?.attendanceRequired).toBe(false);
  });

  it('updates both fields on an existing employee', async () => {
    const created = await asA(() =>
      employees.create({ empCode: `E${seq++}`, fullName: 'Mutable', departmentId: deptA }),
    );
    const updated = await asA(() =>
      employees.update(created.id, { attendanceRequired: false, employmentType: EmploymentType.HOURLY }),
    );
    expect(updated.attendanceRequired).toBe(false);
    expect(updated.employmentType).toBe(EmploymentType.HOURLY);
  });

  it('rejects an employment type outside the enum at the database', async () => {
    const em = orm.em.fork();
    await expect(
      em.getConnection().execute(
        `insert into "employee" (id, company_id, department_id, emp_code, full_name, status, attendance_required, employment_type)
         values (gen_random_uuid(), ?, ?, 'BAD-TYPE', 'x', 'ACTIVE', true, 'WEEKLY')`,
        [companyA, deptA],
      ),
    ).rejects.toThrow();
  });
});
