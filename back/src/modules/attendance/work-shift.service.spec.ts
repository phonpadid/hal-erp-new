import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { Employee } from '../rbac/rbac.entities';
import { EmployeeShift, WorkShift } from './attendance.entities';
import { WorkShiftService } from './work-shift.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/** Minimal valid shift; individual tests override what they are about. */
const base = {
  name: 'Office',
  startTime: '08:00',
  endTime: '17:00',
  standardMinutes: 480,
  halfDayThresholdMinutes: 240,
};

describe.skipIf(!hasDb)('WorkShiftService (DB-backed)', () => {
  let orm: MikroORM;
  let svc: WorkShiftService;
  let companyA = '';
  let companyB = '';
  let deptA = '';
  let employeeA = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    svc = new WorkShiftService(orm.em, new CompanyScopeService(orm.em));
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const d = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    const e = em.create(Employee, { company: a, department: d, empCode: 'E1', fullName: 'Somchai', status: 'ACTIVE' });
    await em.flush();
    companyA = a.id; companyB = b.id; deptA = d.id; employeeA = e.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyB, grants: [] }, fn);

  it('stores times as minutes from midnight', async () => {
    const shift = await asA(() => svc.create({ ...base, code: 'DAY' }));
    expect(shift.startMinute).toBe(480);
    expect(shift.endMinute).toBe(1020);
    expect(shift.crossesMidnight).toBe(false);
    // Defaults land without being asked for.
    expect(shift.graceMinutes).toBe(15);
    expect(shift.otMinMinutes).toBe(30);
    expect(shift.otRoundMinutes).toBe(30);
    expect(shift.isActive).toBe(true);
  });

  it('reads an end at or before the start as the next day', async () => {
    const night = await asA(() =>
      svc.create({ ...base, code: 'NIGHT', startTime: '22:00', endTime: '06:00' }),
    );
    expect(night.startMinute).toBe(1320);
    expect(night.endMinute).toBe(1800);
    expect(night.crossesMidnight).toBe(true);
    // The whole point of the representation: duration needs no branch.
    expect(night.endMinute - night.startMinute).toBe(480);
  });

  it('rejects a duplicate code in the same company but allows it in another', async () => {
    await asA(() => svc.create({ ...base, code: 'SHARED' }));
    await expect(asA(() => svc.create({ ...base, code: 'SHARED' }))).rejects.toThrow(/already exists/);
    const inB = await asB(() => svc.create({ ...base, code: 'SHARED' }));
    expect(inB.id).toBeTruthy();
  });

  it('lists only the active company and only active rows by default', async () => {
    const gone = await asA(() => svc.create({ ...base, code: 'OLD' }));
    await asA(() => svc.deactivate(gone.id));

    const active = await asA(() => svc.list());
    const codes = active.items.map((s) => s.code);
    expect(codes).not.toContain('OLD');
    // Company B's SHARED must not leak into A's list.
    expect(active.items.every((s) => s.company.id === companyA)).toBe(true);

    const all = await asA(() => svc.list({}, true));
    expect(all.items.map((s) => s.code)).toContain('OLD');
  });

  describe('break window', () => {
    it('stores a break as an interval', async () => {
      const shift = await asA(() =>
        svc.create({ ...base, code: 'BRK', breakStartTime: '12:00', breakEndTime: '13:00' }),
      );
      expect(shift.breakStartMinute).toBe(720);
      expect(shift.breakEndMinute).toBe(780);
    });

    it('rejects a break outside the shift span', async () => {
      await expect(
        asA(() => svc.create({ ...base, code: 'BRK_OUT', breakStartTime: '18:00', breakEndTime: '19:00' })),
      ).rejects.toThrow(/within the shift span/);
    });

    it('rejects half a break window', async () => {
      await expect(
        asA(() => svc.create({ ...base, code: 'BRK_HALF', breakStartTime: '12:00' })),
      ).rejects.toThrow(/both a start and an end/);
    });

    it('allows a shift with no break', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'NOBRK' }));
      expect(shift.breakStartMinute).toBeUndefined();
      expect(shift.breakEndMinute).toBeUndefined();
    });

    it('rejects moving the span so an existing break falls outside it', async () => {
      const shift = await asA(() =>
        svc.create({ ...base, code: 'BRK_MOVE', breakStartTime: '12:00', breakEndTime: '13:00' }),
      );
      await expect(
        asA(() => svc.update(shift.id, { startTime: '14:00', endTime: '20:00' })),
      ).rejects.toThrow(/within the shift span/);
    });
  });

  it('rejects an end at or before the start on update', async () => {
    const shift = await asA(() => svc.create({ ...base, code: 'BADUPD' }));
    // 08:00 -> 08:00 normalizes to the next day, which is a legal night shift; an explicit
    // same-minute pair is only invalid when the start moves past it.
    await expect(
      asA(() => svc.update(shift.id, { startTime: '30:00', endTime: '20:00' })),
    ).rejects.toThrow(/must end after it starts/);
  });

  describe('weekday pattern', () => {
    it('defaults each working day to the shift hours and leaves absent days non-working', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'MONFRI' }));
      const days = await asA(() =>
        svc.setDays(shift.id, { days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday })) }),
      );
      expect(days).toHaveLength(5);
      expect(days.every((d) => d.isWorking && d.startMinute === undefined)).toBe(true);
      const stored = await asA(() => svc.getDays(shift.id));
      expect(stored.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
    });

    it('accepts a shorter Saturday via a per-day override', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'SAT' }));
      const days = await asA(() =>
        svc.setDays(shift.id, {
          days: [
            ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday })),
            { weekday: 6, endTime: '12:00' },
          ],
        }),
      );
      const saturday = days.find((d) => d.weekday === 6)!;
      expect(saturday.startMinute).toBeUndefined(); // inherits 08:00
      expect(saturday.endMinute).toBe(720); // 12:00
    });

    it('replaces the pattern wholesale rather than merging', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'REPL' }));
      await asA(() => svc.setDays(shift.id, { days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday })) }));
      await asA(() => svc.setDays(shift.id, { days: [{ weekday: 7 }] }));
      const stored = await asA(() => svc.getDays(shift.id));
      expect(stored.map((d) => d.weekday)).toEqual([7]);
    });

    it('rejects a duplicate weekday', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'DUPDAY' }));
      await expect(
        asA(() => svc.setDays(shift.id, { days: [{ weekday: 3 }, { weekday: 3 }] })),
      ).rejects.toThrow(/Duplicate weekday/);
    });
  });

  describe('deactivation over deletion', () => {
    it('keeps a deactivated shift out of the picker but still readable', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'PICK' }));
      expect((await asA(() => svc.listSelectable())).map((s) => s.code)).toContain('PICK');
      await asA(() => svc.deactivate(shift.id));
      expect((await asA(() => svc.listSelectable())).map((s) => s.code)).not.toContain('PICK');
      expect((await asA(() => svc.get(shift.id))).isActive).toBe(false);
    });

    it('refuses to hard-delete a shift that is assigned to someone', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'ASSIGNED' }));
      const em = orm.em.fork();
      em.create(EmployeeShift, {
        company: em.getReference(Company, companyA),
        employee: em.getReference(Employee, employeeA),
        workShift: em.getReference(WorkShift, shift.id),
        effectiveFrom: '2026-01-01',
      });
      await em.flush();
      await expect(asA(() => svc.remove(shift.id))).rejects.toThrow(/deactivate it instead/);
    });

    it('refuses to hard-delete a shift that is a department default', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'DEPTDEF' }));
      const em = orm.em.fork();
      const dept = await em.findOne(Department, { id: deptA }, FILTER_OFF);
      dept!.defaultWorkShift = em.getReference(WorkShift, shift.id);
      await em.flush();
      await expect(asA(() => svc.remove(shift.id))).rejects.toThrow(/deactivate it instead/);
      // Leave the fixture as it was for later specs.
      dept!.defaultWorkShift = undefined;
      await em.flush();
    });

    it('hard-deletes an unreferenced shift along with its weekday pattern', async () => {
      const shift = await asA(() => svc.create({ ...base, code: 'FREE' }));
      await asA(() => svc.setDays(shift.id, { days: [{ weekday: 1 }] }));
      await asA(() => svc.remove(shift.id));
      await expect(asA(() => svc.get(shift.id))).rejects.toThrow(/not found/);
    });
  });
});
