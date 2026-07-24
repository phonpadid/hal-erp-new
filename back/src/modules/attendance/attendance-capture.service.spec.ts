import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  AttendanceDirection,
  AttendanceSource,
  ControlPolicy,
  GeofenceStatus,
} from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceEvent, WorkLocation } from './attendance.entities';
import { AttendanceCaptureService, DEDUPE_WINDOW_SECONDS } from './attendance-capture.service';
import { GeofenceService } from './geofence.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

// The seeded HQ coordinates, and points at known distances from them.
const HQ = { lat: '13.756331', lng: '100.501765' };
const NEAR_HQ = { lat: '13.756500', lng: '100.501765' }; // ~19 m
const FAR_FROM_HQ = { lat: '13.760000', lng: '100.501765' }; // ~408 m

describe.skipIf(!hasDb)('AttendanceCaptureService (DB-backed)', () => {
  let orm: MikroORM;
  let svc: AttendanceCaptureService;
  let companyA = '';
  let companyB = '';
  let deptA = '';
  let userWithEmployee = '';
  let userWithoutEmployee = '';
  let actorUser = '';
  let employeeA = '';
  let employeeB = '';
  let resignedEmployee = '';
  let exemptEmployee = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    svc = new AttendanceCaptureService(orm.em, scope, new GeofenceService());

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true, timezone: 'Asia/Bangkok', createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', branchCode: '00000', baseCurrency: thb, isActive: true, timezone: 'Asia/Bangkok', createdAt: new Date() });
    const da = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    const db = em.create(Department, { company: b, deptCode: 'DB', name: 'DB', isActive: true });

    const u1 = em.create(AppUser, { username: 'punch-self', email: 'punch-self@x.local', status: 'ACTIVE' });
    const u2 = em.create(AppUser, { username: 'no-employee', email: 'no-employee@x.local', status: 'ACTIVE' });
    const u3 = em.create(AppUser, { username: 'actor', email: 'actor@x.local', status: 'ACTIVE' });

    const ea = em.create(Employee, { company: a, department: da, user: u1, empCode: 'EA', fullName: 'Somchai', status: 'ACTIVE' });
    const eb = em.create(Employee, { company: b, department: db, empCode: 'EB', fullName: 'Other Co', status: 'ACTIVE' });
    const resigned = em.create(Employee, { company: a, department: da, empCode: 'ERES', fullName: 'Gone', status: 'RESIGNED' });
    const exempt = em.create(Employee, { company: a, department: da, empCode: 'EEXE', fullName: 'Exec', status: 'ACTIVE', attendanceRequired: false });
    await em.flush();

    companyA = a.id; companyB = b.id; deptA = da.id;
    userWithEmployee = u1.id; userWithoutEmployee = u2.id; actorUser = u3.id;
    employeeA = ea.id; employeeB = eb.id;
    resignedEmployee = resigned.id; exemptEmployee = exempt.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  function asSelf<T>(fn: () => Promise<T>) {
    return RequestContext.run({ companyId: companyA, userId: userWithEmployee, grants: [] }, fn);
  }
  function asActor<T>(fn: () => Promise<T>) {
    return RequestContext.run({ companyId: companyA, userId: actorUser, grants: [] }, fn);
  }

  /** A fresh employee per test, so one test's punches never trip another's dedupe window. */
  async function freshEmployee(status = 'ACTIVE'): Promise<{ id: string; userId: string }> {
    const em = orm.em.fork();
    const user = em.create(AppUser, { username: `u${seq}`, email: `u${seq}@x.local`, status: 'ACTIVE' });
    const emp = em.create(Employee, {
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptA),
      user,
      empCode: `E${seq++}`,
      fullName: 'Fixture',
      status,
    });
    await em.flush();
    return { id: emp.id, userId: user.id };
  }

  /**
   * Take every location out of play. Deactivates rather than deletes, because the FK deliberately
   * refuses to delete a location a punch references — and because deactivation is the only way
   * the real system retires one.
   */
  async function clearLocations(): Promise<void> {
    const em = orm.em.fork();
    await em.nativeUpdate(WorkLocation, {}, { isActive: false }, FILTER_OFF);
  }

  async function makeLocation(
    lat: string,
    lng: string,
    radiusMeters: number,
    controlPolicy = ControlPolicy.SOFT_WARNING,
  ): Promise<string> {
    const em = orm.em.fork();
    const location = em.create(WorkLocation, {
      company: em.getReference(Company, companyA),
      code: `L${seq++}`,
      name: `Site ${seq}`,
      latitude: lat,
      longitude: lng,
      radiusMeters,
      controlPolicy,
      isActive: true,
    });
    await em.flush();
    return location.id;
  }

  describe('append-only ledger', () => {
    it('stores a punch', async () => {
      await clearLocations();
      const event = await asSelf(() => svc.punchSelf(AttendanceDirection.IN, {}));
      expect(event.direction).toBe(AttendanceDirection.IN);
      expect(event.employee.id).toBe(employeeA);
      expect(event.recordedBy).toBeUndefined();
    });

    it('refuses to update a stored punch', async () => {
      const em = orm.em.fork();
      const event = await em.findOne(AttendanceEvent, { employee: employeeA }, FILTER_OFF);
      event!.remark = 'tampered';
      await expect(em.flush()).rejects.toThrow(/append-only/);
    });

    it('refuses to delete a stored punch', async () => {
      const em = orm.em.fork();
      const event = await em.findOne(AttendanceEvent, { employee: employeeA }, FILTER_OFF);
      em.remove(event!);
      await expect(em.flush()).rejects.toThrow(/append-only/);
    });

    it('supersedes a punch with a corrective row, leaving both readable', async () => {
      const em = orm.em.fork();
      const original = await em.findOne(AttendanceEvent, { employee: employeeA }, FILTER_OFF);
      const correction = em.create(AttendanceEvent, {
        company: em.getReference(Company, companyA),
        employee: em.getReference(Employee, employeeA),
        occurredAt: new Date(),
        localDate: '2026-03-02',
        direction: AttendanceDirection.IN,
        source: AttendanceSource.MANUAL,
        recordedBy: em.getReference(AppUser, actorUser),
        correctsEvent: original!,
        createdAt: new Date(),
      });
      await em.flush();
      const both = await em.find(AttendanceEvent, { employee: employeeA }, FILTER_OFF);
      expect(both.length).toBeGreaterThanOrEqual(2);
      expect(correction.correctsEvent?.id).toBe(original!.id);
      // The superseded row is untouched, which is the whole point of correcting this way.
      const reread = await em.findOne(AttendanceEvent, { id: original!.id }, FILTER_OFF);
      expect(reread).toBeTruthy();
      expect(reread!.remark ?? null).toBeNull();
    });
  });

  describe('self-service', () => {
    it('rejects a caller whose account has no employee here', async () => {
      await expect(
        RequestContext.run({ companyId: companyA, userId: userWithoutEmployee, grants: [] }, () =>
          svc.punchSelf(AttendanceDirection.IN, {}),
        ),
      ).rejects.toThrow(/not linked to an employee/);
    });

    it('rejects half a coordinate pair', async () => {
      const { userId } = await freshEmployee();
      await expect(
        RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
          svc.punchSelf(AttendanceDirection.IN, { latitude: HQ.lat }),
        ),
      ).rejects.toThrow(/both latitude and longitude/);
    });

    it('records the declared source', async () => {
      await clearLocations();
      const { userId } = await freshEmployee();
      const event = await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.punchSelf(AttendanceDirection.IN, { source: AttendanceSource.MOBILE }),
      );
      expect(event.source).toBe(AttendanceSource.MOBILE);
    });
  });

  describe('geofence', () => {
    it('marks a punch inside the radius', async () => {
      await clearLocations();
      await makeLocation(HQ.lat, HQ.lng, 200);
      const { userId } = await freshEmployee();
      const event = await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.punchSelf(AttendanceDirection.IN, { latitude: NEAR_HQ.lat, longitude: NEAR_HQ.lng }),
      );
      expect(event.geofenceStatus).toBe(GeofenceStatus.INSIDE);
      expect(event.distanceMeters).toBeLessThan(200);
      expect(event.workLocation).toBeTruthy();
    });

    it('accepts and flags a punch outside a SOFT_WARNING site', async () => {
      await clearLocations();
      await makeLocation(HQ.lat, HQ.lng, 200, ControlPolicy.SOFT_WARNING);
      const { userId } = await freshEmployee();
      const event = await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.punchSelf(AttendanceDirection.IN, { latitude: FAR_FROM_HQ.lat, longitude: FAR_FROM_HQ.lng }),
      );
      expect(event.geofenceStatus).toBe(GeofenceStatus.OUTSIDE);
      expect(event.distanceMeters).toBeGreaterThan(200);
    });

    it('refuses a punch outside a HARD_STOP site and stores nothing', async () => {
      await clearLocations();
      await makeLocation(HQ.lat, HQ.lng, 200, ControlPolicy.HARD_STOP);
      const { id, userId } = await freshEmployee();
      await expect(
        RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
          svc.punchSelf(AttendanceDirection.IN, { latitude: FAR_FROM_HQ.lat, longitude: FAR_FROM_HQ.lng }),
        ),
      ).rejects.toThrow(/Outside/);
      const em = orm.em.fork();
      expect(await em.find(AttendanceEvent, { employee: id }, FILTER_OFF)).toHaveLength(0);
    });

    it('judges by the nearest location, not the first', async () => {
      await clearLocations();
      // A permissive site far away and a strict one close by: the near strict one must decide.
      await makeLocation('13.700000', '100.501765', 5000, ControlPolicy.SOFT_WARNING);
      await makeLocation(HQ.lat, HQ.lng, 50, ControlPolicy.HARD_STOP);
      const { userId } = await freshEmployee();
      await expect(
        RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
          svc.punchSelf(AttendanceDirection.IN, { latitude: FAR_FROM_HQ.lat, longitude: FAR_FROM_HQ.lng }),
        ),
      ).rejects.toThrow(/Outside/);
    });

    it('is UNKNOWN without coordinates', async () => {
      await clearLocations();
      await makeLocation(HQ.lat, HQ.lng, 200, ControlPolicy.HARD_STOP);
      const { userId } = await freshEmployee();
      const event = await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.punchSelf(AttendanceDirection.IN, {}),
      );
      // Even a HARD_STOP company accepts a punch with no fix — you cannot be outside a fence you
      // were never measured against.
      expect(event.geofenceStatus).toBe(GeofenceStatus.UNKNOWN);
      expect(event.workLocation).toBeUndefined();
      expect(event.distanceMeters).toBeUndefined();
    });

    it('is UNKNOWN when the company has configured no locations', async () => {
      await clearLocations();
      const { userId } = await freshEmployee();
      const event = await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.punchSelf(AttendanceDirection.IN, { latitude: FAR_FROM_HQ.lat, longitude: FAR_FROM_HQ.lng }),
      );
      expect(event.geofenceStatus).toBe(GeofenceStatus.UNKNOWN);
    });

    it('stops measuring against a deactivated location', async () => {
      await clearLocations();
      const locationId = await makeLocation(HQ.lat, HQ.lng, 50, ControlPolicy.HARD_STOP);
      const em = orm.em.fork();
      const location = await em.findOne(WorkLocation, { id: locationId }, FILTER_OFF);
      location!.isActive = false;
      await em.flush();

      const { userId } = await freshEmployee();
      const event = await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.punchSelf(AttendanceDirection.IN, { latitude: FAR_FROM_HQ.lat, longitude: FAR_FROM_HQ.lng }),
      );
      expect(event.geofenceStatus).toBe(GeofenceStatus.UNKNOWN);
    });
  });

  describe('duplicate rejection', () => {
    it('rejects an immediate repeat in the same direction', async () => {
      await clearLocations();
      const { userId } = await freshEmployee();
      const punch = () =>
        RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
          svc.punchSelf(AttendanceDirection.IN, {}),
        );
      await punch();
      await expect(punch()).rejects.toThrow(/within \d+ seconds/);
    });

    it('allows the opposite direction immediately after', async () => {
      await clearLocations();
      const { userId } = await freshEmployee();
      await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.punchSelf(AttendanceDirection.IN, {}),
      );
      await expect(
        RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
          svc.punchSelf(AttendanceDirection.OUT, {}),
        ),
      ).resolves.toBeTruthy();
    });

    it('allows a repeat outside the window, because capture does not judge the sequence', async () => {
      const { id } = await freshEmployee();
      const long_ago = new Date(Date.now() - (DEDUPE_WINDOW_SECONDS + 600) * 1000);
      await asActor(() =>
        svc.punchFor({ employeeId: id, occurredAt: long_ago.toISOString(), direction: AttendanceDirection.IN }),
      );
      // A second IN, hours later — deliberately permitted.
      await expect(
        asActor(() =>
          svc.punchFor({ employeeId: id, occurredAt: new Date().toISOString(), direction: AttendanceDirection.IN }),
        ),
      ).resolves.toBeTruthy();
    });

    /**
     * The dedupe rule lives in the service, so it is only as good as its lock. Two identical
     * requests racing must produce exactly one row — this fails without the FOR UPDATE on the
     * employee, because at READ COMMITTED both reads see an empty window.
     */
    it('stores exactly one event when two identical punches race', async () => {
      await clearLocations();
      const { id, userId } = await freshEmployee();
      const punch = () =>
        RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
          svc.punchSelf(AttendanceDirection.IN, {}),
        );
      const results = await Promise.allSettled([punch(), punch()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const em = orm.em.fork();
      expect(await em.find(AttendanceEvent, { employee: id }, FILTER_OFF)).toHaveLength(1);
    });
  });

  describe('recording for another employee', () => {
    it('stamps MANUAL and the acting user', async () => {
      const { id } = await freshEmployee();
      const event = await asActor(() =>
        svc.punchFor({ employeeId: id, occurredAt: new Date().toISOString(), direction: AttendanceDirection.IN }),
      );
      expect(event.source).toBe(AttendanceSource.MANUAL);
      expect(event.recordedBy?.id).toBe(actorUser);
    });

    it('stamps a backdated punch with the day it happened, not today', async () => {
      const { id } = await freshEmployee();
      // 23:30 UTC is 06:30 the next morning in Bangkok, so the local day rolls forward.
      const event = await asActor(() =>
        svc.punchFor({
          employeeId: id,
          occurredAt: '2026-03-01T23:30:00Z',
          direction: AttendanceDirection.IN,
        }),
      );
      expect(event.localDate).toBe('2026-03-02');
    });

    it('rejects an employee of another company', async () => {
      await expect(
        asActor(() =>
          svc.punchFor({ employeeId: employeeB, occurredAt: new Date().toISOString(), direction: AttendanceDirection.IN }),
        ),
      ).rejects.toThrow(/Unknown employee/);
    });
  });

  describe('bulk roll call', () => {
    it('records the whole crew at one instant', async () => {
      const crew = await Promise.all([freshEmployee(), freshEmployee(), freshEmployee()]);
      const rows = await asActor(() =>
        svc.bulkPunch({
          employeeIds: crew.map((c) => c.id),
          occurredAt: new Date().toISOString(),
          direction: AttendanceDirection.IN,
        }),
      );
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.source === AttendanceSource.MANUAL && r.recordedBy)).toBe(true);
    });

    it('rolls the whole request back when one member is invalid', async () => {
      const crew = await Promise.all([freshEmployee(), freshEmployee()]);
      await expect(
        asActor(() =>
          svc.bulkPunch({
            employeeIds: [...crew.map((c) => c.id), employeeB],
            occurredAt: new Date().toISOString(),
            direction: AttendanceDirection.IN,
          }),
        ),
      ).rejects.toThrow(/Unknown employee/);

      const em = orm.em.fork();
      for (const member of crew) {
        expect(await em.find(AttendanceEvent, { employee: member.id }, FILTER_OFF)).toHaveLength(0);
      }
    });
  });

  describe('employee status', () => {
    it('records an exempt employee like anyone else', async () => {
      const event = await asActor(() =>
        svc.punchFor({ employeeId: exemptEmployee, occurredAt: new Date().toISOString(), direction: AttendanceDirection.IN }),
      );
      expect(event.id).toBeTruthy();
    });

    it('refuses a resigned employee', async () => {
      await expect(
        asActor(() =>
          svc.punchFor({ employeeId: resignedEmployee, occurredAt: new Date().toISOString(), direction: AttendanceDirection.IN }),
        ),
      ).rejects.toThrow(/RESIGNED/);
    });
  });

  describe('reads', () => {
    it('filters by employee and local date, scoped to the company', async () => {
      const { id } = await freshEmployee();
      await asActor(() =>
        svc.punchFor({ employeeId: id, occurredAt: '2026-05-04T03:00:00Z', direction: AttendanceDirection.IN }),
      );
      const page = await asActor(() => svc.list({ employeeId: id, dateFrom: '2026-05-04', dateTo: '2026-05-04' }));
      expect(page.items).toHaveLength(1);
      expect(page.items[0].localDate).toBe('2026-05-04');
    });

    it('finds manual entries by their actor', async () => {
      const page = await asActor(() => svc.list({ manualOnly: true }));
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.items.every((e) => e.source === AttendanceSource.MANUAL)).toBe(true);
    });

    it('returns only the caller own events', async () => {
      await clearLocations();
      const { userId } = await freshEmployee();
      await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.punchSelf(AttendanceDirection.IN, {}),
      );
      const mine = await RequestContext.run({ companyId: companyA, userId, grants: [] }, () =>
        svc.listOwn(),
      );
      expect(mine).toHaveLength(1);
      expect(mine[0].employee.id).not.toBe(employeeA);
    });
  });
});
