import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { WorkShift } from './attendance.entities';
import { EmployeeShiftService } from './employee-shift.service';
import { ShiftResolutionService, isoWeekday } from './shift-resolution.service';
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

// 2026-03-02 is a Monday, 2026-03-07 a Saturday, 2026-03-08 a Sunday.
const MONDAY = '2026-03-02';
const SATURDAY = '2026-03-07';
const SUNDAY = '2026-03-08';

describe('isoWeekday', () => {
  it('numbers Monday 1 through Sunday 7', () => {
    expect(isoWeekday(MONDAY)).toBe(1);
    expect(isoWeekday(SATURDAY)).toBe(6);
    expect(isoWeekday(SUNDAY)).toBe(7);
  });
});

describe.skipIf(!hasDb)('ShiftResolutionService (DB-backed)', () => {
  let orm: MikroORM;
  let resolution: ShiftResolutionService;
  let shifts: WorkShiftService;
  let assignments: EmployeeShiftService;
  let companyA = '';
  let deptWithDefault = '';
  let deptWithout = '';
  let officeShiftId = '';
  let nightShiftId = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    resolution = new ShiftResolutionService(orm.em);
    shifts = new WorkShiftService(orm.em, scope);
    assignments = new EmployeeShiftService(orm.em, scope);

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const d1 = em.create(Department, { company: a, deptCode: 'D1', name: 'With default', isActive: true });
    const d2 = em.create(Department, { company: a, deptCode: 'D2', name: 'Without', isActive: true });
    await em.flush();
    companyA = a.id; deptWithDefault = d1.id; deptWithout = d2.id;

    // OFFICE: Mon-Fri full days, Saturday a shorter day, Sunday absent (non-working).
    const office = await asA(() => shifts.create({ ...base, code: 'OFFICE', breakStartTime: '12:00', breakEndTime: '13:00' }));
    officeShiftId = office.id;
    await asA(() =>
      shifts.setDays(office.id, {
        days: [
          ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday })),
          { weekday: 6, endTime: '12:00' },
        ],
      }),
    );

    const night = await asA(() => shifts.create({ ...base, code: 'NIGHT', startTime: '22:00', endTime: '06:00' }));
    nightShiftId = night.id;
    await asA(() => shifts.setDays(night.id, { days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday })) }));

    const em2 = orm.em.fork();
    const dept = await em2.findOne(Department, { id: deptWithDefault }, FILTER_OFF);
    dept!.defaultWorkShift = em2.getReference(WorkShift, officeShiftId);
    await em2.flush();
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  function asA<T>(fn: () => Promise<T>) {
    return RequestContext.run({ companyId: companyA, grants: [] }, fn);
  }

  async function employeeIn(departmentId: string): Promise<string> {
    const em = orm.em.fork();
    const emp = em.create(Employee, {
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, departmentId),
      empCode: `E-${seq++}`,
      fullName: 'Fixture',
      status: 'ACTIVE',
    });
    await em.flush();
    return emp.id;
  }

  it('prefers a personal assignment over the department default', async () => {
    const employeeId = await employeeIn(deptWithDefault);
    await asA(() => assignments.assign({ employeeId, workShiftId: nightShiftId, effectiveFrom: '2026-01-01' }));
    const resolved = await asA(() => resolution.resolve(employeeId, MONDAY));
    expect(resolved?.shiftCode).toBe('NIGHT');
    expect(resolved?.source).toBe('EMPLOYEE');
  });

  it('falls back to the department default when no assignment covers the date', async () => {
    const employeeId = await employeeIn(deptWithDefault);
    const resolved = await asA(() => resolution.resolve(employeeId, MONDAY));
    expect(resolved?.shiftCode).toBe('OFFICE');
    expect(resolved?.source).toBe('DEPARTMENT');
  });

  it('falls back to the department default outside the assignment range', async () => {
    const employeeId = await employeeIn(deptWithDefault);
    await asA(() =>
      assignments.assign({ employeeId, workShiftId: nightShiftId, effectiveFrom: '2026-01-01', effectiveTo: '2026-02-28' }),
    );
    // MONDAY is 2026-03-02, one day past the assignment's end.
    const resolved = await asA(() => resolution.resolve(employeeId, MONDAY));
    expect(resolved?.shiftCode).toBe('OFFICE');
    expect(resolved?.source).toBe('DEPARTMENT');
  });

  it('returns null — not an error — when nothing is expected', async () => {
    const employeeId = await employeeIn(deptWithout);
    await expect(asA(() => resolution.resolve(employeeId, MONDAY))).resolves.toBeNull();
  });

  it('reports the weekday hours a caller needs to judge the day', async () => {
    const employeeId = await employeeIn(deptWithDefault);
    const monday = await asA(() => resolution.resolve(employeeId, MONDAY));
    expect(monday).toMatchObject({
      isWorkingDay: true,
      expectedIn: '08:00',
      expectedOut: '17:00',
      expectedMinutes: 480,
      graceMinutes: 15,
      breakStartMinute: 720,
      breakEndMinute: 780,
    });
  });

  it('applies a per-day override for the shorter Saturday', async () => {
    const employeeId = await employeeIn(deptWithDefault);
    const saturday = await asA(() => resolution.resolve(employeeId, SATURDAY));
    expect(saturday?.isWorkingDay).toBe(true);
    expect(saturday?.expectedIn).toBe('08:00');
    expect(saturday?.expectedOut).toBe('12:00');
  });

  it('treats a weekday with no pattern row as non-working', async () => {
    const employeeId = await employeeIn(deptWithDefault);
    const sunday = await asA(() => resolution.resolve(employeeId, SUNDAY));
    expect(sunday?.isWorkingDay).toBe(false);
    expect(sunday?.expectedIn).toBeNull();
    expect(sunday?.expectedOut).toBeNull();
    expect(sunday?.expectedMinutes).toBe(0);
  });

  it('reports a night shift ending past midnight in next-day clock form', async () => {
    const employeeId = await employeeIn(deptWithout);
    await asA(() => assignments.assign({ employeeId, workShiftId: nightShiftId, effectiveFrom: '2026-01-01' }));
    const resolved = await asA(() => resolution.resolve(employeeId, MONDAY));
    expect(resolved?.expectedIn).toBe('22:00');
    // 30:00 is 06:00 the following day — unambiguous, unlike a bare "06:00".
    expect(resolved?.expectedOut).toBe('30:00');
    expect(resolved?.expectedOutMinute).toBe(1800);
  });

  /**
   * Deactivation removes a shift from the pickers, but an assignment made before it was
   * deactivated still describes the hours that person was judged against. History has to keep
   * resolving or past attendance becomes unexplainable.
   */
  describe('resolveRange', () => {
    it('returns one result per date, in order', async () => {
      const employeeId = await employeeIn(deptWithDefault);
      const week = await asA(() => resolution.resolveRange(employeeId, MONDAY, SUNDAY));
      expect(week).toHaveLength(7);
      // Mon-Fri working, Sat working with the shorter override, Sun absent from the pattern.
      expect(week.map((d) => d?.isWorkingDay)).toEqual([true, true, true, true, true, true, false]);
      expect(week[5]?.expectedOut).toBe('12:00');
    });

    it('reflects an assignment change part-way through the range', async () => {
      const employeeId = await employeeIn(deptWithout);
      await asA(() =>
        assignments.assign({
          employeeId,
          workShiftId: officeShiftId,
          effectiveFrom: '2026-03-01',
          effectiveTo: '2026-03-04',
        }),
      );
      await asA(() =>
        assignments.assign({ employeeId, workShiftId: nightShiftId, effectiveFrom: '2026-03-05' }),
      );
      const week = await asA(() => resolution.resolveRange(employeeId, MONDAY, '2026-03-06'));
      // Mon-Wed on OFFICE, Thu-Fri on NIGHT.
      expect(week.map((d) => d?.shiftCode)).toEqual([
        'OFFICE', 'OFFICE', 'OFFICE', 'NIGHT', 'NIGHT',
      ]);
    });

    it('falls back to the department default across the whole range', async () => {
      const employeeId = await employeeIn(deptWithDefault);
      const week = await asA(() => resolution.resolveRange(employeeId, MONDAY, '2026-03-06'));
      expect(week.every((d) => d?.source === 'DEPARTMENT')).toBe(true);
    });

    it('returns null for every date when nothing resolves', async () => {
      const employeeId = await employeeIn(deptWithout);
      const week = await asA(() => resolution.resolveRange(employeeId, MONDAY, '2026-03-06'));
      expect(week).toEqual([null, null, null, null, null]);
    });

    it('agrees with the single-date resolve it now backs', async () => {
      const employeeId = await employeeIn(deptWithDefault);
      const [fromRange] = await asA(() => resolution.resolveRange(employeeId, SATURDAY, SATURDAY));
      const single = await asA(() => resolution.resolve(employeeId, SATURDAY));
      expect(single).toEqual(fromRange);
    });
  });

  it('still resolves a deactivated shift for an existing assignment', async () => {
    const employeeId = await employeeIn(deptWithout);
    const doomed = await asA(() => shifts.create({ ...base, code: `GONE-${seq++}` }));
    await asA(() => shifts.setDays(doomed.id, { days: [{ weekday: 1 }] }));
    await asA(() => assignments.assign({ employeeId, workShiftId: doomed.id, effectiveFrom: '2026-01-01' }));
    await asA(() => shifts.deactivate(doomed.id));

    const resolved = await asA(() => resolution.resolve(employeeId, MONDAY));
    expect(resolved?.shiftId).toBe(doomed.id);
    expect(resolved?.isWorkingDay).toBe(true);
  });
});
