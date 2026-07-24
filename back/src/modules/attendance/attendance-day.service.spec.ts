import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  AttendanceDayStatus,
  AttendanceDirection,
  AttendanceSource,
  GeofenceStatus,
} from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department, HolidayCalendar } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDay, AttendanceEvent, WorkShift } from './attendance.entities';
import { AttendanceCaptureService } from './attendance-capture.service';
import { AttendancePeriodGuard } from './attendance-period.guard';
import { AttendanceDayService, localMidnightInstant } from './attendance-day.service';
import { LeaveRequestService } from './leave-request.service';
import { EmployeeShiftService } from './employee-shift.service';
import { GeofenceService } from './geofence.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { WorkShiftService } from './work-shift.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

// A UTC+7 company. 2026-03-02 is a Monday, 2026-03-07 a Saturday, 2026-03-08 a Sunday.
const MONDAY = '2026-03-02';
const TUESDAY = '2026-03-03';
const SUNDAY = '2026-03-08';

const OFFICE = {
  name: 'Office',
  startTime: '08:00',
  endTime: '17:00',
  breakStartTime: '12:00',
  breakEndTime: '13:00',
  standardMinutes: 480,
  halfDayThresholdMinutes: 240,
};

describe.skipIf(!hasDb)('AttendanceDayService (DB-backed)', () => {
  let orm: MikroORM;
  let days: AttendanceDayService;
  let shifts: WorkShiftService;
  let assignments: EmployeeShiftService;
  let capture: AttendanceCaptureService;
  let companyA = '';
  let deptA = '';
  let officeShiftId = '';
  let nightShiftId = '';
  let actorUser = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    const periodGuard = new AttendancePeriodGuard(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    days = new AttendanceDayService(orm.em, scope, resolution, new LeaveRequestService(orm.em, scope, resolution, null as never, periodGuard), periodGuard);
    shifts = new WorkShiftService(orm.em, scope);
    assignments = new EmployeeShiftService(orm.em, scope);
    capture = new AttendanceCaptureService(orm.em, scope, new GeofenceService());

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true, timezone: 'Asia/Bangkok', createdAt: new Date() });
    const d = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    const u = em.create(AppUser, { username: 'day-actor', email: 'day-actor@x.local', status: 'ACTIVE' });
    await em.flush();
    companyA = a.id; deptA = d.id; actorUser = u.id;

    const office = await asA(() => shifts.create({ ...OFFICE, code: 'OFFICE' }));
    officeShiftId = office.id;
    await asA(() => shifts.setDays(office.id, { days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday })) }));

    const night = await asA(() =>
      shifts.create({ ...OFFICE, code: 'NIGHT', startTime: '22:00', endTime: '06:00', breakStartTime: undefined, breakEndTime: undefined }),
    );
    nightShiftId = night.id;
    await asA(() => shifts.setDays(night.id, { days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday })) }));
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  function asA<T>(fn: () => Promise<T>) {
    return RequestContext.run({ companyId: companyA, userId: actorUser, grants: [] }, fn);
  }

  async function freshEmployee(opts: { attendanceRequired?: boolean; shiftId?: string } = {}) {
    const em = orm.em.fork();
    const emp = em.create(Employee, {
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptA),
      empCode: `E${seq++}`,
      fullName: 'Fixture',
      status: 'ACTIVE',
      attendanceRequired: opts.attendanceRequired ?? true,
    });
    await em.flush();
    if (opts.shiftId) {
      await asA(() =>
        assignments.assign({ employeeId: emp.id, workShiftId: opts.shiftId!, effectiveFrom: '2026-01-01' }),
      );
    }
    return emp.id;
  }

  /** Insert a punch directly, so tests can place instants precisely without the capture guards. */
  async function punchAt(employeeId: string, isoInstant: string, direction: AttendanceDirection) {
    const em = orm.em.fork();
    const occurredAt = new Date(isoInstant);
    em.create(AttendanceEvent, {
      company: em.getReference(Company, companyA),
      employee: em.getReference(Employee, employeeId),
      occurredAt,
      localDate: occurredAt.toISOString().slice(0, 10),
      direction,
      source: AttendanceSource.WEB,
      geofenceStatus: GeofenceStatus.UNKNOWN,
      createdAt: new Date(),
    });
    await em.flush();
  }

  /** `HH:MM` local (UTC+7) on a given date, as an ISO instant. */
  const localIso = (date: string, hour: number, minute = 0) =>
    new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`).toISOString();

  describe('localMidnightInstant', () => {
    it('resolves local midnight for a UTC+7 company', () => {
      expect(localMidnightInstant(MONDAY, 'Asia/Bangkok').toISOString()).toBe('2026-03-01T17:00:00.000Z');
    });

    it('resolves local midnight for UTC', () => {
      expect(localMidnightInstant(MONDAY, 'UTC').toISOString()).toBe('2026-03-02T00:00:00.000Z');
    });
  });

  describe('projection basics', () => {
    it('produces one row from the ledger', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      await punchAt(employeeId, localIso(MONDAY, 8), AttendanceDirection.IN);
      await punchAt(employeeId, localIso(MONDAY, 17), AttendanceDirection.OUT);

      const row = await asA(() => days.recomputeDay(employeeId, MONDAY));
      expect(row.status).toBe(AttendanceDayStatus.PRESENT);
      expect(row.workedMinutes).toBe(480);
      expect(row.shiftCode).toBe('OFFICE');
      expect(row.computedAt).toBeInstanceOf(Date);
    });

    it('is idempotent', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      await punchAt(employeeId, localIso(MONDAY, 8, 30), AttendanceDirection.IN);
      await punchAt(employeeId, localIso(MONDAY, 17), AttendanceDirection.OUT);

      const first = await asA(() => days.recomputeDay(employeeId, MONDAY));
      const snapshot = { worked: first.workedMinutes, late: first.lateMinutes, status: first.status };
      const second = await asA(() => days.recomputeDay(employeeId, MONDAY));
      expect({ worked: second.workedMinutes, late: second.lateMinutes, status: second.status }).toEqual(snapshot);

      const em = orm.em.fork();
      expect(await em.find(AttendanceDay, { employee: employeeId }, FILTER_OFF)).toHaveLength(1);
    });

    it('rebuilds after the projection is deleted, because the ledger is the truth', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      await punchAt(employeeId, localIso(MONDAY, 8), AttendanceDirection.IN);
      await punchAt(employeeId, localIso(MONDAY, 17, 45), AttendanceDirection.OUT);
      const before = await asA(() => days.recomputeDay(employeeId, MONDAY));

      const em = orm.em.fork();
      await em.nativeDelete(AttendanceDay, { employee: employeeId }, FILTER_OFF);

      const after = await asA(() => days.recomputeDay(employeeId, MONDAY));
      expect(after.workedMinutes).toBe(before.workedMinutes);
      expect(after.otNormalMinutes).toBe(before.otNormalMinutes);
      expect(after.status).toBe(before.status);
    });

    it('marks a working day with no punches ABSENT', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      const row = await asA(() => days.recomputeDay(employeeId, MONDAY));
      expect(row.status).toBe(AttendanceDayStatus.ABSENT);
    });

    it('marks a non-working weekday DAY_OFF', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      const row = await asA(() => days.recomputeDay(employeeId, SUNDAY));
      expect(row.status).toBe(AttendanceDayStatus.DAY_OFF);
    });

    it('marks an employee with no shift NO_SHIFT', async () => {
      const employeeId = await freshEmployee();
      const row = await asA(() => days.recomputeDay(employeeId, MONDAY));
      expect(row.status).toBe(AttendanceDayStatus.NO_SHIFT);
    });

    it('marks an exempt employee EXEMPT rather than ABSENT', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId, attendanceRequired: false });
      const row = await asA(() => days.recomputeDay(employeeId, MONDAY));
      expect(row.status).toBe(AttendanceDayStatus.EXEMPT);
    });
  });

  describe('snapshot versus re-read', () => {
    it('does not change an already-computed row when the shift is edited', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      await punchAt(employeeId, localIso(TUESDAY, 8, 20), AttendanceDirection.IN);
      await punchAt(employeeId, localIso(TUESDAY, 17), AttendanceDirection.OUT);
      const before = await asA(() => days.recomputeDay(employeeId, TUESDAY));
      expect(before.lateMinutes).toBe(20);

      // Move the shift start later; the stored verdict must not move with it.
      await asA(() => shifts.update(officeShiftId, { startTime: '08:30' }));
      const em = orm.em.fork();
      const stored = await em.findOne(AttendanceDay, { id: before.id }, FILTER_OFF);
      expect(stored!.lateMinutes).toBe(20);
      expect(stored!.expectedInMinute).toBe(480);

      // Only an explicit recompute adopts the new hours.
      const after = await asA(() => days.recomputeDay(employeeId, TUESDAY));
      expect(after.expectedInMinute).toBe(510);
      expect(after.lateMinutes).toBe(0);

      await asA(() => shifts.update(officeShiftId, { startTime: '08:00' }));
    });

    it('reclassifies when a holiday is declared retroactively', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      const date = '2026-04-06';
      const absent = await asA(() => days.recomputeDay(employeeId, date));
      expect(absent.status).toBe(AttendanceDayStatus.ABSENT);

      const em = orm.em.fork();
      em.create(HolidayCalendar, {
        company: em.getReference(Company, companyA),
        holidayDate: date,
        name: 'Chakri Day',
      });
      await em.flush();

      const after = await asA(() => days.recomputeDay(employeeId, date));
      expect(after.status).toBe(AttendanceDayStatus.HOLIDAY);
    });
  });

  /**
   * The case the whole shift-window decision exists for: punches on two calendar dates must land
   * on ONE row. Grouping by the punch's own local_date would produce two incomplete half-days.
   */
  it('collects a night shift spanning midnight into a single day', async () => {
    const employeeId = await freshEmployee({ shiftId: nightShiftId });
    await punchAt(employeeId, localIso(MONDAY, 22, 5), AttendanceDirection.IN);
    await punchAt(employeeId, localIso(TUESDAY, 5, 58), AttendanceDirection.OUT);

    const row = await asA(() => days.recomputeDay(employeeId, MONDAY));
    expect(row.status).toBe(AttendanceDayStatus.PRESENT);
    expect(row.punchCount).toBe(2);
    expect(row.workedMinutes).toBe(473);

    // And the following day does not also claim them.
    const next = await asA(() => days.recomputeDay(employeeId, TUESDAY));
    expect(next.status).toBe(AttendanceDayStatus.ABSENT);
  });

  describe('range and company recomputation', () => {
    it('computes every date in a range', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      const rows = await asA(() => days.recomputeRange(employeeId, MONDAY, SUNDAY));
      expect(rows).toHaveLength(7);
      expect(rows.map((r) => r.shiftDate)).toEqual([
        '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08',
      ]);
      // Mon-Fri are working days, Sat and Sun are not (the OFFICE pattern is weekdays 1-5).
      expect(rows.slice(0, 5).every((r) => r.status === AttendanceDayStatus.ABSENT)).toBe(true);
      expect(rows[6].status).toBe(AttendanceDayStatus.DAY_OFF);
    });

    it('rejects a backwards range', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      await expect(asA(() => days.recomputeRange(employeeId, TUESDAY, MONDAY))).rejects.toThrow(/must not precede/);
    });

    it('writes a row for every employee of the company', async () => {
      const written = await asA(() => days.recomputeCompanyDate(MONDAY));
      const em = orm.em.fork();
      const employees = await em.find(Employee, { company: companyA }, FILTER_OFF);
      expect(written).toBe(employees.length);
      const rows = await em.find(AttendanceDay, { shiftDate: MONDAY }, FILTER_OFF);
      expect(rows).toHaveLength(employees.length);
    });
  });

  /**
   * The projection row is read then written, so at READ COMMITTED two concurrent recomputes would
   * both miss the existing row and both insert — violating the unique key or interleaving into a
   * half-updated row. This fails without the FOR UPDATE in `persistDay`.
   */
  it('leaves exactly one consistent row when two recomputes race', async () => {
    const employeeId = await freshEmployee({ shiftId: officeShiftId });
    await punchAt(employeeId, localIso(TUESDAY, 8), AttendanceDirection.IN);
    await punchAt(employeeId, localIso(TUESDAY, 17), AttendanceDirection.OUT);

    const results = await Promise.allSettled([
      asA(() => days.recomputeDay(employeeId, TUESDAY)),
      asA(() => days.recomputeDay(employeeId, TUESDAY)),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const em = orm.em.fork();
    const rows = await em.find(AttendanceDay, { employee: employeeId, shiftDate: TUESDAY }, FILTER_OFF);
    expect(rows).toHaveLength(1);
    expect(rows[0].workedMinutes).toBe(480);
  });

  it('is not written by capture — the ledger is the truth and the projection follows', async () => {
    const em0 = orm.em.fork();
    const user = em0.create(AppUser, { username: `cap${seq}`, email: `cap${seq}@x.local`, status: 'ACTIVE' });
    const emp = em0.create(Employee, {
      company: em0.getReference(Company, companyA),
      department: em0.getReference(Department, deptA),
      user,
      empCode: `ECAP${seq++}`,
      fullName: 'Capture',
      status: 'ACTIVE',
    });
    await em0.flush();

    await RequestContext.run({ companyId: companyA, userId: user.id, grants: [] }, () =>
      capture.punchSelf(AttendanceDirection.IN, {}),
    );

    const em = orm.em.fork();
    expect(await em.find(AttendanceDay, { employee: emp.id }, FILTER_OFF)).toHaveLength(0);
  });

  describe('reads', () => {
    it('filters by employee, range and status, and exposes computedAt', async () => {
      const employeeId = await freshEmployee({ shiftId: officeShiftId });
      await asA(() => days.recomputeRange(employeeId, MONDAY, TUESDAY));

      const page = await asA(() =>
        days.list({ employeeId, dateFrom: MONDAY, dateTo: TUESDAY, status: AttendanceDayStatus.ABSENT }),
      );
      expect(page.items).toHaveLength(2);
      expect(page.items.every((r) => r.computedAt instanceof Date)).toBe(true);
      expect(page.items.map((r) => r.shiftDate)).toEqual([MONDAY, TUESDAY]);
    });

    it('scopes reads to the active company', async () => {
      const page = await asA(() => days.list({}));
      expect(page.items.every((r) => r.company.id === companyA)).toBe(true);
    });

    it('returns only the caller own days from the self-service read', async () => {
      const em0 = orm.em.fork();
      const user = em0.create(AppUser, { username: `own${seq}`, email: `own${seq}@x.local`, status: 'ACTIVE' });
      const emp = em0.create(Employee, {
        company: em0.getReference(Company, companyA),
        department: em0.getReference(Department, deptA),
        user,
        empCode: `EOWN${seq++}`,
        fullName: 'Owner',
        status: 'ACTIVE',
      });
      await em0.flush();
      await RequestContext.run({ companyId: companyA, userId: user.id, grants: [] }, () =>
        days.recomputeRange(emp.id, MONDAY, TUESDAY),
      );

      const mine = await RequestContext.run({ companyId: companyA, userId: user.id, grants: [] }, () =>
        days.listOwn({}),
      );
      expect(mine.items).toHaveLength(2);
      expect(mine.items.every((r) => r.employee.id === emp.id)).toBe(true);
    });

    it('ignores an employee id supplied to the self-service read', async () => {
      // The read is gated on ATTEND_DAY_SELF precisely because it cannot reach anyone else. If a
      // query parameter could redirect it, that code would grant the power the general list does
      // and the separation would be decorative.
      const em0 = orm.em.fork();
      const user = em0.create(AppUser, { username: `own${seq}`, email: `own${seq}@x.local`, status: 'ACTIVE' });
      const mine = em0.create(Employee, {
        company: em0.getReference(Company, companyA),
        department: em0.getReference(Department, deptA),
        user,
        empCode: `EOWN${seq++}`,
        fullName: 'Owner',
        status: 'ACTIVE',
      });
      const theirs = em0.create(Employee, {
        company: em0.getReference(Company, companyA),
        department: em0.getReference(Department, deptA),
        empCode: `EOTH${seq++}`,
        fullName: 'Somebody else',
        status: 'ACTIVE',
      });
      await em0.flush();
      await RequestContext.run({ companyId: companyA, userId: user.id, grants: [] }, async () => {
        await days.recomputeRange(mine.id, MONDAY, TUESDAY);
        await days.recomputeRange(theirs.id, MONDAY, TUESDAY);
      });

      const page = await RequestContext.run(
        { companyId: companyA, userId: user.id, grants: [] },
        () => days.listOwn({ employeeId: theirs.id } as never),
      );
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((r) => r.employee.id === mine.id)).toBe(true);
      expect(page.items.some((r) => r.employee.id === theirs.id)).toBe(false);
    });
  });
});
