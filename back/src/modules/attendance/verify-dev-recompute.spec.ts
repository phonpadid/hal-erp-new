import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { AttendanceDay } from './attendance.entities';
import { AttendanceDayService } from './attendance-day.service';
import { LeaveRequestService } from './leave-request.service';
import { ShiftResolutionService } from './shift-resolution.service';
import type { MikroORM } from '@mikro-orm/postgresql';

/**
 * Task 9.2 — recompute a real date against the DEV database and inspect the result by hand.
 *
 * Deliberately does NOT call refreshDatabase(): this runs against seeded dev data, so it must read
 * the world as it is. It writes only `attendance_day`, which is a rebuildable projection, and
 * recomputation is idempotent — so the worst case is a row that can be regenerated.
 *
 * Runs only when DB_NAME points at the dev database, so a normal test run skips it entirely.
 */
const hasDb = await dbAvailable();
const isDevDb = process.env.DB_NAME === 'new_erp';
const FILTER_OFF = { filters: { company: false } } as const;

// A Monday. The seeded OFFICE shift works weekdays 1-5, so this is a working day.
const MONDAY = '2026-03-02';
// A Saturday — the half-day the user confirmed their company works.
const SATURDAY = '2026-03-07';
const SUNDAY = '2026-03-08';

describe.skipIf(!hasDb || !isDevDb)('dev-database recompute (manual verification)', () => {
  let orm: MikroORM;
  let days: AttendanceDayService;
  let companyId = '';
  let employeeId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    const scope = new CompanyScopeService(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    days = new AttendanceDayService(orm.em, scope, resolution, new LeaveRequestService(orm.em, scope, resolution, null as never));

    const em = orm.em.fork();
    const company = await em.findOne(Company, { code: 'HAL' }, FILTER_OFF);
    const employee = await em.findOne(Employee, { empCode: 'EMP-REQ' }, FILTER_OFF);
    companyId = company!.id;
    employeeId = employee!.id;
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  const asHal = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ companyId, grants: [] }, fn);

  it('resolves the seeded employee through the department default and reports the day', async () => {
    const row = await asHal(() => days.recomputeDay(employeeId, MONDAY));
    // The seeded employee sits in PROC, whose default_work_shift_id is OFFICE, and has no punches.
    expect(row.shiftCode).toBe('OFFICE');
    expect(row.expectedInMinute).toBe(480);
    expect(row.expectedOutMinute).toBe(1020);
    expect(row.status).toBe('ABSENT');
    // eslint-disable-next-line no-console
    console.log('MONDAY   ', row.shiftDate, row.status, `${row.expectedInMinute}-${row.expectedOutMinute}`, 'worked', row.workedMinutes);
  });

  it('reports the seeded Saturday as a working half day', async () => {
    const row = await asHal(() => days.recomputeDay(employeeId, SATURDAY));
    expect(row.expectedInMinute).toBe(480);
    expect(row.expectedOutMinute).toBe(720); // 12:00 — the override the user confirmed
    expect(row.status).toBe('ABSENT'); // a working day with no punches
    // eslint-disable-next-line no-console
    console.log('SATURDAY ', row.shiftDate, row.status, `${row.expectedInMinute}-${row.expectedOutMinute}`);
  });

  it('reports Sunday as a day off', async () => {
    const row = await asHal(() => days.recomputeDay(employeeId, SUNDAY));
    expect(row.status).toBe('DAY_OFF');
    // eslint-disable-next-line no-console
    console.log('SUNDAY   ', row.shiftDate, row.status);
  });

  it('leaves exactly one row per day and is repeatable', async () => {
    await asHal(() => days.recomputeDay(employeeId, MONDAY));
    const em = orm.em.fork();
    const rows = await em.find(AttendanceDay, { employee: employeeId, shiftDate: MONDAY }, FILTER_OFF);
    expect(rows).toHaveLength(1);
  });
});
