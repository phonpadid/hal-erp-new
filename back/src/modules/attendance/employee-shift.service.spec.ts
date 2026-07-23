import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { EmployeeShift } from './attendance.entities';
import { EmployeeShiftService } from './employee-shift.service';
import { WorkShiftService } from './work-shift.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

const base = {
  name: 'Office',
  startTime: '08:00',
  endTime: '17:00',
  standardMinutes: 480,
  halfDayThresholdMinutes: 240,
};

describe.skipIf(!hasDb)('EmployeeShiftService assignment (DB-backed)', () => {
  let orm: MikroORM;
  let svc: EmployeeShiftService;
  let shifts: WorkShiftService;
  let companyA = '';
  let companyB = '';
  let shiftA = '';
  let shiftA2 = '';
  let shiftB = '';
  let employeeA = '';
  let employeeB = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    svc = new EmployeeShiftService(orm.em, scope);
    shifts = new WorkShiftService(orm.em, scope);

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const da = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    const db = em.create(Department, { company: b, deptCode: 'DB', name: 'DB', isActive: true });
    const ea = em.create(Employee, { company: a, department: da, empCode: 'EA', fullName: 'A', status: 'ACTIVE' });
    const eb = em.create(Employee, { company: b, department: db, empCode: 'EB', fullName: 'B', status: 'ACTIVE' });
    await em.flush();
    companyA = a.id; companyB = b.id; employeeA = ea.id; employeeB = eb.id;

    shiftA = (await asA(() => shifts.create({ ...base, code: 'A1' }))).id;
    shiftA2 = (await asA(() => shifts.create({ ...base, code: 'A2' }))).id;
    shiftB = (await asB(() => shifts.create({ ...base, code: 'B1' }))).id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  function asA<T>(fn: () => Promise<T>) {
    return RequestContext.run({ companyId: companyA, grants: [] }, fn);
  }
  function asB<T>(fn: () => Promise<T>) {
    return RequestContext.run({ companyId: companyB, grants: [] }, fn);
  }

  /** A fresh employee per test, so one test's ranges never constrain another's. */
  async function freshEmployee(): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOne(Department, { company: companyA }, FILTER_OFF);
    const emp = em.create(Employee, {
      company: em.getReference(Company, companyA),
      department: dept!,
      empCode: `EMP-${seq++}`,
      fullName: 'Fixture',
      status: 'ACTIVE',
    });
    await em.flush();
    return emp.id;
  }

  it('assigns an open-ended shift', async () => {
    const employeeId = await freshEmployee();
    const row = await asA(() =>
      svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-01-01' }),
    );
    expect(row.effectiveFrom).toBe('2026-01-01');
    expect(row.effectiveTo).toBeUndefined();
  });

  it('accepts consecutive non-overlapping ranges', async () => {
    const employeeId = await freshEmployee();
    await asA(() =>
      svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }),
    );
    await asA(() => svc.assign({ employeeId, workShiftId: shiftA2, effectiveFrom: '2026-07-01' }));
    const rows = await asA(() => svc.listForEmployee(employeeId));
    expect(rows).toHaveLength(2);
  });

  it('rejects a range overlapping an open-ended assignment', async () => {
    const employeeId = await freshEmployee();
    await asA(() => svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-01-01' }));
    await expect(
      asA(() => svc.assign({ employeeId, workShiftId: shiftA2, effectiveFrom: '2026-03-01' })),
    ).rejects.toThrow(/already has a shift assignment/);
  });

  it('rejects a range that straddles an existing closed range', async () => {
    const employeeId = await freshEmployee();
    await asA(() =>
      svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-03-01', effectiveTo: '2026-03-31' }),
    );
    await expect(
      asA(() =>
        svc.assign({ employeeId, workShiftId: shiftA2, effectiveFrom: '2026-02-01', effectiveTo: '2026-04-30' }),
      ),
    ).rejects.toThrow(/already has a shift assignment/);
  });

  it('rejects effectiveTo before effectiveFrom', async () => {
    const employeeId = await freshEmployee();
    await expect(
      asA(() =>
        svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-05-01', effectiveTo: '2026-04-01' }),
      ),
    ).rejects.toThrow(/must not precede/);
  });

  it('rejects a shift from another company', async () => {
    const employeeId = await freshEmployee();
    await expect(
      asA(() => svc.assign({ employeeId, workShiftId: shiftB, effectiveFrom: '2026-01-01' })),
    ).rejects.toThrow(/Unknown work shift/);
  });

  it('rejects an employee from another company', async () => {
    await expect(
      asA(() => svc.assign({ employeeId: employeeB, workShiftId: shiftA, effectiveFrom: '2026-01-01' })),
    ).rejects.toThrow(/Unknown employee/);
  });

  it('closes an open-ended assignment', async () => {
    const employeeId = await freshEmployee();
    const row = await asA(() =>
      svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-01-01' }),
    );
    const closed = await asA(() => svc.end(row.id, { effectiveTo: '2026-06-30' }));
    expect(closed.effectiveTo).toBe('2026-06-30');
  });

  it('rejects extending an assignment into the next one', async () => {
    const employeeId = await freshEmployee();
    const first = await asA(() =>
      svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }),
    );
    await asA(() => svc.assign({ employeeId, workShiftId: shiftA2, effectiveFrom: '2026-07-01' }));
    await expect(
      asA(() => svc.end(first.id, { effectiveTo: '2026-08-31' })),
    ).rejects.toThrow(/already has a shift assignment/);
  });

  /**
   * The overlap rule lives in the service, so it is only as good as its transaction boundary.
   * Two concurrent assignments for one employee must not both read a clear field and both
   * insert — exactly one survives, whether it loses to the service check or to the
   * (employee, effective_from) unique index.
   */
  it('does not let two concurrent overlapping assignments both succeed', async () => {
    const employeeId = await freshEmployee();
    const results = await Promise.allSettled([
      asA(() => svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-01-01' })),
      asA(() => svc.assign({ employeeId, workShiftId: shiftA2, effectiveFrom: '2026-01-01' })),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);

    const em = orm.em.fork();
    const stored = await em.find(EmployeeShift, { employee: employeeId }, FILTER_OFF);
    expect(stored).toHaveLength(1);
  });

  /**
   * The same race with DIFFERENT start dates, so the `(employee, effective_from)` unique index
   * cannot save us — overlapping open-ended ranges are distinct rows at the index level. Only
   * the read-then-write inside one transaction can reject this, which makes it the test that
   * actually guards the design decision.
   */
  it('rejects concurrent overlapping ranges the unique index cannot catch', async () => {
    const employeeId = await freshEmployee();
    const results = await Promise.allSettled([
      asA(() => svc.assign({ employeeId, workShiftId: shiftA, effectiveFrom: '2026-01-01' })),
      asA(() => svc.assign({ employeeId, workShiftId: shiftA2, effectiveFrom: '2026-03-01' })),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);

    const em = orm.em.fork();
    const stored = await em.find(EmployeeShift, { employee: employeeId }, FILTER_OFF);
    expect(stored).toHaveLength(1);
  });
});
