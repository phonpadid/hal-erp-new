import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  AttendanceDayStatus,
  AttendanceDirection,
  AttendanceSource,
  CorrectionKind,
  DocCategory,
  DocStatus,
  GeofenceStatus,
} from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDay, AttendanceEvent, TimeCorrection } from './attendance.entities';
import { AttendanceDayService } from './attendance-day.service';
import { CorrectionApprovedListener } from './correction-approved.listener';
import { EmployeeShiftService } from './employee-shift.service';
import { LeaveRequestService } from './leave-request.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { TimeCorrectionService } from './time-correction.service';
import { WorkShiftService } from './work-shift.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

const OFFICE = {
  name: 'Office',
  startTime: '08:00',
  endTime: '17:00',
  breakStartTime: '12:00',
  breakEndTime: '13:00',
  standardMinutes: 480,
  halfDayThresholdMinutes: 240,
};

/**
 * The window is measured against the real clock, so the dates here are relative to today rather
 * than fixed. A fixture pinned to 2026-03-02 would start failing the moment it aged past thirty
 * days, and would have proved nothing about the rule in the meantime.
 */
const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasDb)('TimeCorrectionService (DB-backed)', () => {
  let orm: MikroORM;
  let corrections: TimeCorrectionService;
  let days: AttendanceDayService;
  let listener: CorrectionApprovedListener;
  let shifts: WorkShiftService;
  let assignments: EmployeeShiftService;
  let companyA = '';
  let companyB = '';
  let deptA = '';
  let deptB = '';
  let officeShiftId = '';
  let docTypeId = '';
  let templateId = '';
  let workflowId = '';
  let requesterId = '';
  let approverId = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    days = new AttendanceDayService(
      orm.em,
      scope,
      resolution,
      new LeaveRequestService(orm.em, scope, resolution, null as never),
    );
    corrections = new TimeCorrectionService(orm.em, scope, resolution);
    listener = new CorrectionApprovedListener(orm.em, days);
    shifts = new WorkShiftService(orm.em, scope);
    assignments = new EmployeeShiftService(orm.em, scope);

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, {
      code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true,
      timezone: 'Asia/Bangkok', createdAt: new Date(),
    });
    const b = em.create(Company, {
      code: 'B', nameTh: 'B', branchCode: '00000', baseCurrency: thb, isActive: true,
      timezone: 'Asia/Bangkok', createdAt: new Date(),
    });
    const da = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    const db = em.create(Department, { company: b, deptCode: 'DB', name: 'DB', isActive: true });
    const requester = em.create(AppUser, { username: 'tc-req', email: 'tc-req@x.local', status: 'ACTIVE' });
    const approver = em.create(AppUser, { username: 'tc-app', email: 'tc-app@x.local', status: 'ACTIVE' });
    const dt = em.create(DocumentType, {
      company: a, code: 'TCORR', name: 'Time correction', category: DocCategory.HR,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      requiresPayee: false, requiresWarehouse: false, isActive: true,
    } as never);
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, isActive: true } as never);
    const wf = em.create(Workflow, { company: a, name: 'TC WF', isActive: true } as never);
    await em.flush();
    companyA = a.id; companyB = b.id; deptA = da.id; deptB = db.id;
    requesterId = requester.id; approverId = approver.id;
    docTypeId = dt.id; templateId = tmpl.id; workflowId = wf.id;

    const office = await asA(() => shifts.create({ ...OFFICE, code: 'OFFICE' }));
    officeShiftId = office.id;
    await asA(() => shifts.setDays(office.id, { days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday })) }));
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  function asA<T>(fn: () => Promise<T>) {
    return RequestContext.run({ companyId: companyA, userId: requesterId, grants: [] }, fn);
  }

  async function freshEmployee(companyId = companyA, departmentId = deptA, withShift = true) {
    const em = orm.em.fork();
    const emp = em.create(Employee, {
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, departmentId),
      empCode: `E${seq++}`,
      fullName: 'Fixture',
      status: 'ACTIVE',
      attendanceRequired: true,
    });
    await em.flush();
    if (withShift && companyId === companyA) {
      await asA(() =>
        assignments.assign({ employeeId: emp.id, workShiftId: officeShiftId, effectiveFrom: '2020-01-01' }),
      );
    }
    return emp.id;
  }

  /** `HH:MM` local (UTC+7) on a date, as an instant. */
  const localAt = (date: string, hour: number, minute = 0) =>
    new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`);

  /** A captured punch, inserted directly so the fixture places the instant exactly. */
  async function punch(
    employeeId: string,
    at: Date,
    direction: AttendanceDirection,
    companyId = companyA,
  ): Promise<string> {
    const em = orm.em.fork();
    const event = em.create(AttendanceEvent, {
      company: em.getReference(Company, companyId),
      employee: em.getReference(Employee, employeeId),
      occurredAt: at,
      localDate: at.toISOString().slice(0, 10),
      direction,
      source: AttendanceSource.WEB,
      geofenceStatus: GeofenceStatus.UNKNOWN,
      createdAt: new Date(),
    });
    await em.flush();
    return event.id;
  }

  async function draft(): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `TC-${seq++}`,
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptA),
      documentType: em.getReference(DocumentType, docTypeId),
      formTemplate: em.getReference(FormTemplate, templateId),
      workflow: em.getReference(Workflow, workflowId),
      createdBy: em.getReference(AppUser, requesterId),
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  /** What the router emits after its transaction commits. */
  const approve = (documentId: string) =>
    listener.onOutcome({ documentId, status: 'COMPLETED', approverId });

  const eventsOf = (employeeId: string) =>
    orm.em.fork().find(AttendanceEvent, { employee: employeeId }, { ...FILTER_OFF, orderBy: { createdAt: 'ASC' }, populate: ['correctsEvent', 'recordedBy'] });

  describe('what a request may say', () => {
    it('stores an ADD with an instant and no target', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft();
      const shiftDate = daysAgo(2);
      const correction = await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.ADD,
          requestedAt: localAt(shiftDate, 17).toISOString(),
          requestedDirection: AttendanceDirection.OUT,
          reason: 'Forgot to scan out',
        }),
      );
      expect(correction.kind).toBe(CorrectionKind.ADD);
      expect(correction.targetEvent).toBeUndefined();
      expect(correction.requestedAt).toEqual(localAt(shiftDate, 17));
    });

    it('stores a CHANGE naming the punch it moves', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8, 2), AttendanceDirection.IN);
      const documentId = await draft();
      const correction = await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.CHANGE, targetEventId,
          requestedAt: localAt(shiftDate, 9, 2).toISOString(),
          requestedDirection: AttendanceDirection.IN,
          reason: 'The clock was wrong',
        }),
      );
      expect(correction.targetEvent?.id).toBe(targetEventId);
    });

    it('stores a REMOVE naming the punch it voids, with no instant of its own', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8, 5), AttendanceDirection.IN);
      const documentId = await draft();
      const correction = await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.REMOVE, targetEventId,
          reason: 'Scanned twice',
        }),
      );
      expect(correction.requestedAt).toBeUndefined();
      expect(correction.requestedDirection).toBeUndefined();
    });

    it('refuses a CHANGE with nothing to change', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft();
      const shiftDate = daysAgo(2);
      await expect(
        asA(() =>
          corrections.create({
            documentId, employeeId, shiftDate, kind: CorrectionKind.CHANGE,
            requestedAt: localAt(shiftDate, 9).toISOString(),
            requestedDirection: AttendanceDirection.IN,
            reason: 'No target',
          }),
        ),
      ).rejects.toThrow(/must name the punch/i);
    });

    it('refuses an ADD that names an existing punch', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8), AttendanceDirection.IN);
      const documentId = await draft();
      await expect(
        asA(() =>
          corrections.create({
            documentId, employeeId, shiftDate, kind: CorrectionKind.ADD, targetEventId,
            requestedAt: localAt(shiftDate, 17).toISOString(),
            requestedDirection: AttendanceDirection.OUT,
            reason: 'Nothing to supersede',
          }),
        ),
      ).rejects.toThrow(/nothing to supersede/i);
    });

    it('refuses a REMOVE that supplies an instant', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8), AttendanceDirection.IN);
      const documentId = await draft();
      await expect(
        asA(() =>
          corrections.create({
            documentId, employeeId, shiftDate, kind: CorrectionKind.REMOVE, targetEventId,
            requestedAt: localAt(shiftDate, 9).toISOString(),
            reason: 'A removal has no time',
          }),
        ),
      ).rejects.toThrow(/supplies no instant/i);
    });

    it('refuses a CHANGE that would move nothing', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const at = localAt(shiftDate, 8, 2);
      const targetEventId = await punch(employeeId, at, AttendanceDirection.IN);
      const documentId = await draft();
      await expect(
        asA(() =>
          corrections.create({
            documentId, employeeId, shiftDate, kind: CorrectionKind.CHANGE, targetEventId,
            requestedAt: at.toISOString(),
            requestedDirection: AttendanceDirection.IN,
            reason: 'Same time',
          }),
        ),
      ).rejects.toThrow(/same instant and direction/i);
    });

    it("refuses a target that belongs to someone else", async () => {
      const mine = await freshEmployee();
      const theirs = await freshEmployee();
      const shiftDate = daysAgo(2);
      const targetEventId = await punch(theirs, localAt(shiftDate, 8), AttendanceDirection.IN);
      const documentId = await draft();
      await expect(
        asA(() =>
          corrections.create({
            documentId, employeeId: mine, shiftDate, kind: CorrectionKind.REMOVE, targetEventId,
            reason: 'Not mine to correct',
          }),
        ),
      ).rejects.toThrow(/different employee/i);
    });

    it('cannot see a target belonging to another company', async () => {
      const mine = await freshEmployee();
      const outsider = await freshEmployee(companyB, deptB, false);
      const shiftDate = daysAgo(2);
      const targetEventId = await punch(outsider, localAt(shiftDate, 8), AttendanceDirection.IN, companyB);
      const documentId = await draft();
      await expect(
        asA(() =>
          corrections.create({
            documentId, employeeId: mine, shiftDate, kind: CorrectionKind.REMOVE, targetEventId,
            reason: 'Another company',
          }),
        ),
      ).rejects.toThrow(/Unknown attendance event/i);
    });

    it('allows only one correction per document', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft();
      const shiftDate = daysAgo(2);
      const body = {
        documentId, employeeId, shiftDate, kind: CorrectionKind.ADD,
        requestedAt: localAt(shiftDate, 17).toISOString(),
        requestedDirection: AttendanceDirection.OUT,
        reason: 'Once',
      };
      await asA(() => corrections.create(body));
      await expect(asA(() => corrections.create(body))).rejects.toThrow(/already carries/i);
    });
  });

  describe('the correction window', () => {
    const addOn = (documentId: string, employeeId: string, shiftDate: string) =>
      corrections.create({
        documentId, employeeId, shiftDate, kind: CorrectionKind.ADD,
        requestedAt: localAt(shiftDate, 17).toISOString(),
        requestedDirection: AttendanceDirection.OUT,
        reason: 'Window check',
      });

    it('accepts a recent shift day', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft();
      const correction = await asA(() => addOn(documentId, employeeId, daysAgo(2)));
      expect(correction.id).toBeTruthy();
    });

    it('rejects a shift day older than the window', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft();
      await expect(asA(() => addOn(documentId, employeeId, daysAgo(60)))).rejects.toThrow(
        /allows corrections up to 30 days back/i,
      );
    });

    it('measures the window from the shift day, so raising it later changes nothing', async () => {
      // Both requests are raised now; only the shift day differs. If the window were measured from
      // the request date, both would pass.
      const employeeId = await freshEmployee();
      const recentDoc = await draft();
      const oldDoc = await draft();
      await expect(asA(() => addOn(recentDoc, employeeId, daysAgo(29)))).resolves.toBeTruthy();
      await expect(asA(() => addOn(oldDoc, employeeId, daysAgo(31)))).rejects.toThrow(/30 days back/i);
    });

    it('honours a window the company has changed', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft();
      await asA(() => corrections.setWindow(90));
      try {
        await expect(asA(() => addOn(documentId, employeeId, daysAgo(60)))).resolves.toBeTruthy();
      } finally {
        await asA(() => corrections.setWindow(30));
      }
      expect((await asA(() => corrections.window())).correctionWindowDays).toBe(30);
    });
  });

  describe('approval writes the corrective event', () => {
    it('inserts nothing while the correction is only a draft', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      await punch(employeeId, localAt(shiftDate, 8), AttendanceDirection.IN);
      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.ADD,
          requestedAt: localAt(shiftDate, 17).toISOString(),
          requestedDirection: AttendanceDirection.OUT,
          reason: 'Not yet approved',
        }),
      );
      expect(await eventsOf(employeeId)).toHaveLength(1);
    });

    it('inserts a MANUAL punch recorded against the approver, naming its target', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8, 2), AttendanceDirection.IN);
      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.CHANGE, targetEventId,
          requestedAt: localAt(shiftDate, 9, 2).toISOString(),
          requestedDirection: AttendanceDirection.IN,
          reason: 'The clock was wrong',
        }),
      );
      await approve(documentId);

      const events = await eventsOf(employeeId);
      expect(events).toHaveLength(2);
      const corrective = events.find((e) => e.correctsEvent)!;
      expect(corrective.source).toBe(AttendanceSource.MANUAL);
      // The approver, not the requester: a hand-entered punch answers to whoever authorised it.
      expect(corrective.recordedBy?.id).toBe(approverId);
      expect(corrective.recordedBy?.id).not.toBe(requesterId);
      expect(corrective.correctsEvent?.id).toBe(targetEventId);
      expect(corrective.occurredAt).toEqual(localAt(shiftDate, 9, 2));
      // Stamped from the company clock on its own instant: 09:02 in Bangkok is that local date.
      expect(corrective.localDate).toBe(shiftDate);
      // And the original is untouched.
      const original = events.find((e) => e.id === targetEventId)!;
      expect(original.occurredAt).toEqual(localAt(shiftDate, 8, 2));
      expect(original.source).toBe(AttendanceSource.WEB);
    });

    it('leaves an ADD naming nothing', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.ADD,
          requestedAt: localAt(shiftDate, 17).toISOString(),
          requestedDirection: AttendanceDirection.OUT,
          reason: 'Forgot to scan out',
        }),
      );
      await approve(documentId);
      const [corrective] = await eventsOf(employeeId);
      expect(corrective.correctsEvent).toBeNull();
      expect(corrective.source).toBe(AttendanceSource.MANUAL);
    });

    it('restates its target exactly when the correction is a REMOVE', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const at = localAt(shiftDate, 8, 5);
      const targetEventId = await punch(employeeId, at, AttendanceDirection.IN);
      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.REMOVE, targetEventId,
          reason: 'Scanned twice',
        }),
      );
      await approve(documentId);

      const events = await eventsOf(employeeId);
      const corrective = events.find((e) => e.correctsEvent)!;
      expect(corrective.occurredAt).toEqual(at);
      expect(corrective.direction).toBe(AttendanceDirection.IN);
    });

    it('only ever gains rows — nothing is updated and nothing is deleted', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8, 2), AttendanceDirection.IN);
      const before = await eventsOf(employeeId);
      const snapshot = before.map((e) => ({ id: e.id, at: e.occurredAt.getTime(), src: e.source }));

      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.CHANGE, targetEventId,
          requestedAt: localAt(shiftDate, 9).toISOString(),
          requestedDirection: AttendanceDirection.IN,
          reason: 'Append only',
        }),
      );
      await approve(documentId);

      const after = await eventsOf(employeeId);
      expect(after.length).toBe(before.length + 1);
      for (const row of snapshot) {
        const still = after.find((e) => e.id === row.id)!;
        expect(still.occurredAt.getTime()).toBe(row.at);
        expect(still.source).toBe(row.src);
      }
    });
  });

  describe('the day the correction fixes', () => {
    it('turns an INCOMPLETE day into a worked one', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      await punch(employeeId, localAt(shiftDate, 8), AttendanceDirection.IN);

      const before = await asA(() => days.recomputeDay(employeeId, shiftDate));
      expect(before.status).toBe(AttendanceDayStatus.INCOMPLETE);
      expect(before.workedMinutes).toBe(0);

      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.ADD,
          requestedAt: localAt(shiftDate, 17).toISOString(),
          requestedDirection: AttendanceDirection.OUT,
          reason: 'Forgot to scan out',
        }),
      );
      await approve(documentId);

      const after = await orm.em.fork().findOne(
        AttendanceDay,
        { employee: employeeId, shiftDate },
        FILTER_OFF,
      );
      expect(after!.status).toBe(AttendanceDayStatus.PRESENT);
      expect(after!.workedMinutes).toBe(480);
    });

    it('stops counting a punch a CHANGE superseded', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(3);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8, 2), AttendanceDirection.IN);
      await punch(employeeId, localAt(shiftDate, 17), AttendanceDirection.OUT);
      const before = await asA(() => days.recomputeDay(employeeId, shiftDate));
      expect(before.firstInAt).toEqual(localAt(shiftDate, 8, 2));

      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.CHANGE, targetEventId,
          requestedAt: localAt(shiftDate, 7, 55).toISOString(),
          requestedDirection: AttendanceDirection.IN,
          reason: 'Scanned at the gate, not the door',
        }),
      );
      await approve(documentId);

      const after = await orm.em.fork().findOne(AttendanceDay, { employee: employeeId, shiftDate }, FILTER_OFF);
      expect(after!.firstInAt).toEqual(localAt(shiftDate, 7, 55));
      expect(after!.punchCount).toBe(2);
      expect(after!.lateMinutes).toBe(0);
    });

    it('drops both rows of a REMOVE, leaving the real punches to decide the day', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(3);
      await punch(employeeId, localAt(shiftDate, 8), AttendanceDirection.IN);
      const dupId = await punch(employeeId, localAt(shiftDate, 8, 5), AttendanceDirection.IN);
      await punch(employeeId, localAt(shiftDate, 17), AttendanceDirection.OUT);

      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.REMOVE, targetEventId: dupId,
          reason: 'Scanned twice',
        }),
      );
      await approve(documentId);

      const after = await orm.em.fork().findOne(AttendanceDay, { employee: employeeId, shiftDate }, FILTER_OFF);
      expect(after!.punchCount).toBe(2);
      expect(after!.firstInAt).toEqual(localAt(shiftDate, 8));
      expect(after!.lastOutAt).toEqual(localAt(shiftDate, 17));
      expect(after!.workedMinutes).toBe(480);
      // The voided punch and its voiding row are both still in the ledger.
      expect(await eventsOf(employeeId)).toHaveLength(4);
    });

    it('keeps the approval and its punch when the recomputation fails', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(2);
      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.ADD,
          requestedAt: localAt(shiftDate, 17).toISOString(),
          requestedDirection: AttendanceDirection.OUT,
          reason: 'Recompute will throw',
        }),
      );

      const original = days.recomputeDay.bind(days);
      (days as unknown as { recomputeDay: () => Promise<never> }).recomputeDay = () => {
        throw new Error('projection unavailable');
      };
      try {
        // Does not reject: a human decision must not be discarded because a derived number could
        // not be written.
        await expect(approve(documentId)).resolves.toBeUndefined();
      } finally {
        (days as unknown as { recomputeDay: typeof original }).recomputeDay = original;
      }

      const events = await eventsOf(employeeId);
      expect(events).toHaveLength(1);
      expect(events[0].source).toBe(AttendanceSource.MANUAL);
    });

    it('resolves to one day when two corrections target the same punch', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(3);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8, 30), AttendanceDirection.IN);
      await punch(employeeId, localAt(shiftDate, 17), AttendanceDirection.OUT);

      for (const hour of [8, 9]) {
        const documentId = await draft();
        await asA(() =>
          corrections.create({
            documentId, employeeId, shiftDate, kind: CorrectionKind.CHANGE, targetEventId,
            requestedAt: localAt(shiftDate, hour, 10).toISOString(),
            requestedDirection: AttendanceDirection.IN,
            reason: `Correction at ${hour}`,
          }),
        );
        await approve(documentId);
      }

      const after = await orm.em.fork().findOne(AttendanceDay, { employee: employeeId, shiftDate }, FILTER_OFF);
      // Both corrective rows stand — neither names the other — and the day is still one coherent
      // row rather than an error.
      expect(after!.firstInAt).toEqual(localAt(shiftDate, 8, 10));
      expect(after!.punchCount).toBe(3);
      expect(after!.status).toBe(AttendanceDayStatus.PRESENT);
    });
  });

  describe('picking a target', () => {
    it('lists the day punches and hides ones already superseded', async () => {
      const employeeId = await freshEmployee();
      const shiftDate = daysAgo(3);
      const targetEventId = await punch(employeeId, localAt(shiftDate, 8, 2), AttendanceDirection.IN);
      await punch(employeeId, localAt(shiftDate, 17), AttendanceDirection.OUT);

      const before = await asA(() => corrections.correctablePunches(employeeId, shiftDate));
      expect(before.map((e) => e.id)).toContain(targetEventId);

      const documentId = await draft();
      await asA(() =>
        corrections.create({
          documentId, employeeId, shiftDate, kind: CorrectionKind.CHANGE, targetEventId,
          requestedAt: localAt(shiftDate, 9).toISOString(),
          requestedDirection: AttendanceDirection.IN,
          reason: 'Already corrected once',
        }),
      );
      await approve(documentId);

      const after = await asA(() => corrections.correctablePunches(employeeId, shiftDate));
      expect(after.map((e) => e.id)).not.toContain(targetEventId);
      expect(after).toHaveLength(2);
    });
  });

  it('never writes anything onto the projection itself', () => {
    // A correction names a punch, never a number. If it could carry worked minutes or a status,
    // someone would eventually set them directly and the projection would stop being reproducible
    // from the ledger and the configuration alone. The columns are the guarantee.
    const meta = orm.getMetadata().get(TimeCorrection.name);
    const columns = Object.keys(meta.properties).sort();
    expect(columns).toEqual([
      'company',
      'document',
      'employee',
      'id',
      'kind',
      'reason',
      'requestedAt',
      'requestedDirection',
      'shiftDate',
      'targetEvent',
    ]);
  });

  it('stores the request but never a corrective event of its own', async () => {
    const rows = await orm.em.fork().find(TimeCorrection, {}, FILTER_OFF);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });
});
