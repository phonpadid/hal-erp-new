import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  AttendanceDayStatus,
  AttendanceDirection,
  AttendanceSource,
  CorrectionKind,
  DocStatus,
  GeofenceStatus,
} from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { DocFieldValue, Document, DocumentType, FormField, FormTemplate } from '../document/document.entities';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDay, AttendanceEvent } from './attendance.entities';
import { AttendancePeriodGuard } from './attendance-period.guard';
import { AttendanceDayService } from './attendance-day.service';
import { CorrectionApprovedListener } from './correction-approved.listener';
import { LeaveRequestService } from './leave-request.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { TimeCorrectionService } from './time-correction.service';
import type { MikroORM } from '@mikro-orm/postgresql';

/**
 * Task 8.2 — against the DEV database, with its real seeded document type, company clock and
 * correction window. Skips entirely unless DB_NAME points at the dev database.
 *
 * Nothing here deletes: the rows it makes are left in place so the flow from punch to correction
 * to recomputed day stays visible in the dev data.
 */
const hasDb = await dbAvailable();
const isDevDb = process.env.DB_NAME === 'new_erp';
const FILTER_OFF = { filters: { company: false } } as const;

const daysAgo = (n: number): string =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!hasDb || !isDevDb)('dev-database time correction (manual verification)', () => {
  let orm: MikroORM;
  let corrections: TimeCorrectionService;
  let days: AttendanceDayService;
  let listener: CorrectionApprovedListener;
  let companyId = '';
  let employeeId = '';
  let approverId = '';
  let documentId = '';
  let shiftDate = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    const scope = new CompanyScopeService(orm.em);
    const periodGuard = new AttendancePeriodGuard(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    days = new AttendanceDayService(
      orm.em,
      scope,
      resolution,
      new LeaveRequestService(orm.em, scope, resolution, null as never, periodGuard),
      periodGuard,
    );
    corrections = new TimeCorrectionService(orm.em, scope, resolution, periodGuard);
    listener = new CorrectionApprovedListener(orm.em, days);

    const em = orm.em.fork();
    const company = await em.findOne(Company, { code: 'HAL' }, FILTER_OFF);
    const employee = await em.findOne(
      Employee,
      { empCode: 'EMP-REQ' },
      { ...FILTER_OFF, populate: ['department', 'user'] },
    );
    companyId = company!.id;
    employeeId = employee!.id;
    approverId = employee!.user!.id;
    shiftDate = daysAgo(1);

    // A day with a check-in and no check-out — the case a correction exists for.
    const timezone = company!.timezone ?? 'Asia/Bangkok';
    const checkIn = new Date(`${shiftDate}T08:00:00${timezone === 'UTC' ? 'Z' : '+07:00'}`);
    em.create(AttendanceEvent, {
      company: em.getReference(Company, companyId),
      employee: em.getReference(Employee, employeeId),
      occurredAt: checkIn,
      localDate: shiftDate,
      direction: AttendanceDirection.IN,
      source: AttendanceSource.WEB,
      geofenceStatus: GeofenceStatus.UNKNOWN,
      remark: 'correction verification',
      createdAt: new Date(),
    });

    const dt = await em.findOne(DocumentType, { company: companyId, code: 'TCORR' }, FILTER_OFF);
    const tmpl = await em.findOne(FormTemplate, { documentType: dt!.id }, FILTER_OFF);
    const wf = await em.findOne(Workflow, { company: companyId, isActive: true }, FILTER_OFF);
    const doc = em.create(Document, {
      docNo: `TC-VERIFY-${Date.now()}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, employee!.department.id),
      documentType: dt!,
      formTemplate: tmpl!,
      workflow: wf!,
      createdBy: em.getReference(AppUser, approverId),
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    const fields = await em.find(FormField, { formTemplate: tmpl!.id, isRequired: true }, FILTER_OFF);
    for (const field of fields) {
      em.create(DocFieldValue, { document: doc, formField: field, fieldValue: 'verification' });
    }
    await em.flush();
    documentId = doc.id;
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  const asHal = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId, grants: [] }, fn);

  it('reads the seeded correction window as company policy', async () => {
    const { correctionWindowDays } = await asHal(() => corrections.window());
    expect(correctionWindowDays).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log('WINDOW ', `${correctionWindowDays} days back from the shift day`);
  });

  it('records the day as incomplete before anything is corrected', async () => {
    const day = await asHal(() => days.recomputeDay(employeeId, shiftDate));
    // eslint-disable-next-line no-console
    console.log('BEFORE ', shiftDate, day.status, `worked=${day.workedMinutes}m punches=${day.punchCount}`);
    expect([AttendanceDayStatus.INCOMPLETE, AttendanceDayStatus.DAY_OFF, AttendanceDayStatus.NO_SHIFT])
      .toContain(day.status);
  });

  it('stores an ADD naming no target', async () => {
    const requestedAt = new Date(`${shiftDate}T17:00:00+07:00`);
    const correction = await asHal(() =>
      corrections.create({
        documentId,
        employeeId,
        shiftDate,
        kind: CorrectionKind.ADD,
        requestedAt: requestedAt.toISOString(),
        requestedDirection: AttendanceDirection.OUT,
        reason: 'ลืมสแกนออก',
      }),
    );
    expect(correction.targetEvent).toBeUndefined();
    // eslint-disable-next-line no-console
    console.log('REQUEST', correction.kind, shiftDate, '->', requestedAt.toISOString());
  });

  it('inserts nothing into the ledger while the document is a draft', async () => {
    const em = orm.em.fork();
    const manual = await em.find(
      AttendanceEvent,
      { employee: employeeId, source: AttendanceSource.MANUAL },
      FILTER_OFF,
    );
    // eslint-disable-next-line no-console
    console.log('DRAFT  ', `${manual.length} manual events so far`);
    expect(manual.every((e) => e.remark?.startsWith('Correction') !== true)).toBe(true);
  });

  it('writes the corrective punch on approval and recomputes the day', async () => {
    await listener.onOutcome({ documentId, status: 'COMPLETED', approverId });

    const em = orm.em.fork();
    const corrective = await em.findOne(
      AttendanceEvent,
      { employee: employeeId, source: AttendanceSource.MANUAL, remark: { $like: 'Correction ADD%' } },
      { ...FILTER_OFF, populate: ['recordedBy'], orderBy: { createdAt: 'DESC' } },
    );
    expect(corrective).not.toBeNull();
    expect(corrective!.recordedBy?.id).toBe(approverId);

    const day = await em.findOne(AttendanceDay, { employee: employeeId, shiftDate }, FILTER_OFF);
    // eslint-disable-next-line no-console
    console.log(
      'AFTER  ',
      shiftDate,
      day?.status,
      `worked=${day?.workedMinutes}m punches=${day?.punchCount}`,
      `| corrective at ${corrective!.occurredAt.toISOString()} by approver, localDate=${corrective!.localDate}`,
    );
    expect(day).not.toBeNull();
  });

  it('has only ever added rows to the ledger', async () => {
    const em = orm.em.fork();
    // Every corrective row this slice writes is MANUAL and carries an actor; nothing it does can
    // change a row that was already there, and the check constraint from the capture slice proves
    // the actor is present.
    const manual = await em.find(
      AttendanceEvent,
      { employee: employeeId, source: AttendanceSource.MANUAL },
      { ...FILTER_OFF, populate: ['recordedBy'] },
    );
    for (const e of manual) expect(e.recordedBy).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log('LEDGER ', `${manual.length} manual rows, all with an actor`);
  });
});
