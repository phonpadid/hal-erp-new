import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { JobLevel } from '../job-level/job-level.entities';
import { JobLevelService } from '../job-level/job-level.service';
import { EmailVerificationService } from './email-verification.service';
import { EmailTransport } from '../notification/transports/transport';
import { PasswordService } from './password.service';
import { EmployeeService } from './employee.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

// employee.job_level, when present, MUST resolve to an active job_level.code in the employee's
// company (employee-registry). Empty is allowed. Covers create, update, and the promotion path.
describe.skipIf(!hasDb)('EmployeeService job-level validation (DB-backed)', () => {
  let orm: MikroORM;
  let employees: EmployeeService;
  let companyA = '';
  let companyB = '';
  let deptA = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    employees = new EmployeeService(
      orm.em,
      new PasswordService(),
      new EmailVerificationService(orm.em, new EmailTransport()),
      new JobLevelService(orm.em, new CompanyScopeService(orm.em)),
    );
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const d = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    // 'MANAGER' is active only in company A. Company B has none.
    em.create(JobLevel, { company: a, code: 'MANAGER', name: 'Manager', rank: 30, isActive: true });
    em.create(JobLevel, { company: a, code: 'RETIRED', name: 'Retired', rank: 99, isActive: false });
    await em.flush();
    companyA = a.id; companyB = b.id; deptA = d.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyA, grants: [] }, fn);

  let empSeq = 0;
  const base = () => ({ empCode: `E-${empSeq++}`, fullName: 'W', departmentId: deptA });

  it('creates with a valid job level', async () => {
    const e = await asA(() => employees.create({ ...base(), jobLevel: 'MANAGER' }));
    expect(e.jobLevel).toBe('MANAGER');
  });

  it('allows an empty/absent job level', async () => {
    const e = await asA(() => employees.create({ ...base() }));
    expect(e.jobLevel).toBeUndefined();
  });

  it('rejects an unknown job level on create', async () => {
    await expect(asA(() => employees.create({ ...base(), jobLevel: 'NOPE' }))).rejects.toThrow(/Unknown job level/);
  });

  it('rejects an inactive job level on create', async () => {
    await expect(asA(() => employees.create({ ...base(), jobLevel: 'RETIRED' }))).rejects.toThrow(/Unknown job level/);
  });

  it('rejects an unknown job level on update but accepts a valid one', async () => {
    const e = await asA(() => employees.create({ ...base() }));
    await expect(asA(() => employees.update(e.id, { jobLevel: 'NOPE' }))).rejects.toThrow(/Unknown job level/);
    const updated = await asA(() => employees.update(e.id, { jobLevel: 'MANAGER' }));
    expect(updated.jobLevel).toBe('MANAGER');
  });

  it('validates the promotion path against the company master', async () => {
    const e = await asA(() => employees.create({ ...base() }));
    await orm.em.fork().transactional((tem) =>
      expect(employees.applyPromotion(e.id, { jobLevel: 'NOPE' }, companyA, tem)).rejects.toThrow(/Unknown job level/),
    );
    await orm.em.fork().transactional((tem) => employees.applyPromotion(e.id, { jobLevel: 'MANAGER' }, companyA, tem));
    const reloaded = await asA(() => employees.get(e.id));
    expect(reloaded.jobLevel).toBe('MANAGER');
  });
});
