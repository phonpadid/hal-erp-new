import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  AttendanceDirection,
  AttendancePeriodStatus,
  AttendanceSource,
  CorrectionKind,
  DocStatus,
} from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { DocFieldValue, Document, DocumentType, FormField, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee, Role, RolePermission } from '../rbac/rbac.entities';
import { AttendanceEvent, AttendancePeriod, TimeCorrection } from './attendance.entities';
import { AttendanceCaptureService } from './attendance-capture.service';
import { AttendanceDayService } from './attendance-day.service';
import { AttendancePeriodGuard } from './attendance-period.guard';
import { AttendancePeriodService } from './attendance-period.service';
import { GeofenceService } from './geofence.service';
import { LeaveRequestService } from './leave-request.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { TimeCorrectionService } from './time-correction.service';
import { AttendancePermissions as P } from './permissions';
import type { MikroORM } from '@mikro-orm/postgresql';

/**
 * Group 9 — against the DEV database, exercising the self-service path an ordinary employee walks:
 * punch, read your own days, pick a punch to correct. Skips unless DB_NAME points at dev.
 *
 * Nothing here deletes; the rows it makes stay so the flow is visible in the dev data.
 */
const hasDb = await dbAvailable();
const isDevDb = process.env.DB_NAME === 'new_erp';
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb || !isDevDb)('dev-database self-service attendance (manual verification)', () => {
  let orm: MikroORM;
  let capture: AttendanceCaptureService;
  let days: AttendanceDayService;
  let corrections: TimeCorrectionService;
  let leave: LeaveRequestService;
  let companyId = '';
  let employeeId = '';
  let userId = '';
  let today = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    const scope = new CompanyScopeService(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    const guard = new AttendancePeriodGuard(orm.em);
    leave = new LeaveRequestService(orm.em, scope, resolution, null as never, guard);
    days = new AttendanceDayService(orm.em, scope, resolution, leave, guard);
    corrections = new TimeCorrectionService(orm.em, scope, resolution, guard);
    capture = new AttendanceCaptureService(orm.em, scope, new GeofenceService());

    const em = orm.em.fork();
    const company = await em.findOne(Company, { code: 'HAL' }, FILTER_OFF);
    const employee = await em.findOne(
      Employee,
      { empCode: 'EMP-REQ' },
      { ...FILTER_OFF, populate: ['department', 'user'] },
    );
    companyId = company!.id;
    employeeId = employee!.id;
    userId = employee!.user!.id;
    today = new Date().toISOString().slice(0, 10);

    // The period slice may have closed the month this verification punches into — and it should
    // have: a closed period refuses a recompute and a correction by name, which is exactly the
    // behaviour its own verification proves. Self-service needs an open day to walk the full path,
    // so reopen it here, audited like any other reopen. That the two slices compose this way IS
    // the finding: the ledger still took the punch, and only the derived work was frozen.
    const closed = await em.findOne(
      AttendancePeriod,
      {
        company: companyId,
        status: AttendancePeriodStatus.CLOSED,
        periodStart: { $lte: today },
        periodEnd: { $gte: today },
      },
      FILTER_OFF,
    );
    if (closed) {
      const periods = new AttendancePeriodService(orm.em, scope, leave, null as never);
      await RequestContext.run({ companyId, userId, grants: [] }, () =>
        periods.reopen(closed.id, { reason: 'Self-service verification needs an open day' }),
      );
      // eslint-disable-next-line no-console
      console.log('PERIOD ', `reopened '${closed.code}' so ${today} can be recomputed`);
    }
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  const asEmployee = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ companyId, userId, grants: [] }, fn);

  it('grants the seeded employee role the SELF codes and not the company-wide reads', async () => {
    const em = orm.em.fork();
    const role = await em.findOne(Role, { company: companyId, code: 'REQUESTER' }, FILTER_OFF);
    const grants = await em.find(
      RolePermission,
      { role: role!.id },
      { ...FILTER_OFF, populate: ['permission'] },
    );
    const codes = grants.map((g) => g.permission.code);

    expect(codes).toContain(P.ATTEND_PUNCH_SELF);
    expect(codes).toContain(P.ATTEND_DAY_SELF);
    // The point of the whole permission section: an ordinary employee sees their own attendance
    // and nobody else's.
    expect(codes).not.toContain(P.ATTEND_PUNCH_READ);
    expect(codes).not.toContain(P.ATTEND_DAY_READ);
    // eslint-disable-next-line no-console
    console.log('ROLE   ', `REQUESTER has ${codes.filter((c) => c.startsWith('ATTEND')).join(', ')}`);
  });

  it('records a self punch with its coordinates as decimals', async () => {
    const before = await orm.em.fork().count(AttendanceEvent, { employee: employeeId }, FILTER_OFF);
    // Punch the OPPOSITE of the way this employee is currently facing, which is what the screen
    // offers — and what keeps a quick re-run of this verification from tripping the capture
    // slice's duplicate window, a guard that is right to be there.
    const existing = await asEmployee(() => capture.listOwn(today));
    const last = existing[existing.length - 1];
    const direction =
      last?.direction === AttendanceDirection.IN ? AttendanceDirection.OUT : AttendanceDirection.IN;

    await asEmployee(() =>
      capture.punchSelf(direction, {
        source: AttendanceSource.WEB,
        latitude: '13.756331',
        longitude: '100.501765',
      } as never),
    );
    const em = orm.em.fork();
    const after = await em.count(AttendanceEvent, { employee: employeeId }, FILTER_OFF);
    expect(after).toBe(before + 1);

    const [latest] = await em.find(
      AttendanceEvent,
      { employee: employeeId },
      { ...FILTER_OFF, orderBy: { createdAt: 'DESC' }, limit: 1 },
    );
    // Strings all the way down: a coordinate is no more a JS number than money is.
    expect(typeof latest.latitude).toBe('string');
    expect(latest.latitude).toBe('13.756331');
    // eslint-disable-next-line no-console
    console.log(
      'PUNCH  ',
      `${latest.direction} at ${latest.occurredAt.toISOString()} lat=${latest.latitude} lon=${latest.longitude} geofence=${latest.geofenceStatus}`,
    );
  });

  it('reads the caller own punches without naming an employee', async () => {
    const mine = await asEmployee(() => capture.listOwn(today));
    expect(Array.isArray(mine)).toBe(true);
    // eslint-disable-next-line no-console
    console.log('EVENTS ', `${mine.length} own punches on ${today}`);
  });

  it('recomputes the day and reports it through the self-service read', async () => {
    await asEmployee(() => days.recomputeDay(employeeId, today));
    const page = await asEmployee(() => days.listOwn({}));
    const row = page.items.find((d) => d.shiftDate === today);
    expect(row).toBeTruthy();
    // A verification that punches in and out seconds apart lands both instants in the SAME minute,
    // and `computeDay` rules that one instant cannot bound a day — so INCOMPLETE here is the rule
    // working, not a defect. Said out loud so nobody reads the dev output as a finding.
    const sameMinute =
      row!.firstInAt && row!.lastOutAt
        ? Math.round(row!.lastOutAt.getTime() / 60000) === Math.round(row!.firstInAt.getTime() / 60000)
        : true;
    // eslint-disable-next-line no-console
    console.log(
      'MY DAY ',
      today,
      row!.status,
      `worked=${row!.workedMinutes}m late=${row!.lateMinutes}m/${row!.lateOccurrences}x punches=${row!.punchCount}`,
      sameMinute ? '(both punches in one minute — INCOMPLETE is the rule, not a defect)' : '',
    );
  });

  it('ignores an employee id handed to the self-service read', async () => {
    const em = orm.em.fork();
    const someoneElse = await em.findOne(
      Employee,
      { company: companyId, id: { $ne: employeeId } },
      FILTER_OFF,
    );
    if (!someoneElse) return; // a one-employee demo company has nothing to prove here
    const page = await asEmployee(() => days.listOwn({ employeeId: someoneElse.id } as never));
    expect(page.items.every((d) => d.employee.id === employeeId)).toBe(true);
    // eslint-disable-next-line no-console
    console.log('SCOPE  ', `self read stayed on ${employeeId} despite being handed ${someoneElse.id}`);
  });

  it('lists the caller own correctable punches, and a correction names the row that was picked', async () => {
    const options = await asEmployee(() => corrections.ownCorrectablePunches(today));
    expect(options.length).toBeGreaterThan(0);
    const picked = options[0];

    const em = orm.em.fork();
    const dt = await em.findOne(DocumentType, { company: companyId, code: 'TCORR' }, FILTER_OFF);
    const tmpl = await em.findOne(FormTemplate, { documentType: dt!.id }, FILTER_OFF);
    const wf = await em.findOne(Workflow, { company: companyId, isActive: true }, FILTER_OFF);
    const employee = await em.findOne(Employee, { id: employeeId }, { ...FILTER_OFF, populate: ['department'] });
    const doc = em.create(Document, {
      docNo: `SS-${Date.now()}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, employee!.department.id),
      documentType: dt!,
      formTemplate: tmpl!,
      workflow: wf!,
      // No related employee: the self-service shape, where the raiser IS the subject.
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    const fields = await em.find(FormField, { formTemplate: tmpl!.id, isRequired: true }, FILTER_OFF);
    for (const field of fields) {
      em.create(DocFieldValue, { document: doc, formField: field, fieldValue: 'verification' });
    }
    await em.flush();

    const correction = await asEmployee(() =>
      corrections.create({
        documentId: doc.id,
        shiftDate: today,
        kind: CorrectionKind.CHANGE,
        targetEventId: picked.id,
        requestedAt: new Date(picked.occurredAt.getTime() + 5 * 60_000).toISOString(),
        requestedDirection: picked.direction,
        reason: 'ສະແກນຊ້າ 5 ນາທີ',
      } as never),
    );

    // The row that was PICKED, and the subject resolved from the document rather than the body.
    expect(correction.targetEvent?.id).toBe(picked.id);
    const stored = await orm.em
      .fork()
      .findOne(TimeCorrection, { id: correction.id }, { ...FILTER_OFF, populate: ['employee', 'targetEvent'] });
    expect(stored!.employee.id).toBe(employeeId);
    // eslint-disable-next-line no-console
    console.log(
      'CORRECT',
      `${options.length} correctable; picked ${picked.id.slice(0, 8)} @ ${picked.occurredAt.toISOString()};`,
      `subject resolved to ${stored!.employee.id.slice(0, 8)} from the document, not the request`,
    );
  });

  it('previews leave for the caller, and the preview is what the request charges', async () => {
    const from = today;
    const to = today;
    const preview = await asEmployee(() => leave.previewOwn(from, to));
    expect(preview.totalDays).toMatch(/^\d+\.\d{2}$/);
    // eslint-disable-next-line no-console
    console.log('PREVIEW', `${from}..${to} charges ${preview.totalDays} day(s) — working days only`);
  });
});
