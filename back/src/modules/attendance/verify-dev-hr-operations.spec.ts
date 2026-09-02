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
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { DocFieldValue, Document, DocumentType, FormField, FormTemplate } from '../document/document.entities';
import { DocumentSubmitService } from '../document/document-submit.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDay, AttendanceEvent, AttendancePeriod, TimeCorrection } from './attendance.entities';
import { AttendanceCaptureService } from './attendance-capture.service';
import { AttendanceDayService } from './attendance-day.service';
import { AttendancePeriodGuard } from './attendance-period.guard';
import { AttendancePeriodService } from './attendance-period.service';
import { GeofenceService } from './geofence.service';
import { LeaveRequestService } from './leave-request.service';
import { OvertimeClaimService } from './overtime-claim.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { TimeCorrectionService } from './time-correction.service';
import type { MikroORM } from '@mikro-orm/postgresql';

/**
 * Group 8 — the HR month-end walk against the DEV database: declare, read coverage, recompute the
 * range, close, reopen, re-close, punch on behalf, and correct somebody else's punch.
 * Skips unless DB_NAME points at dev. Nothing here deletes.
 */
const hasDb = await dbAvailable();
const isDevDb = process.env.DB_NAME === 'new_erp';
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb || !isDevDb)('dev-database HR operations (manual verification)', () => {
  let orm: MikroORM;
  let periods: AttendancePeriodService;
  let days: AttendanceDayService;
  let capture: AttendanceCaptureService;
  let corrections: TimeCorrectionService;
  let companyId = '';
  let employeeId = '';
  let userId = '';
  let periodId = '';
  const CODE = `VERIFY-${Date.now()}`;
  // A window far from anything the other verifications touch, so the counts mean something.
  const FROM = '2027-03-01';
  const TO = '2027-03-03';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    const scope = new CompanyScopeService(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    const guard = new AttendancePeriodGuard(orm.em);
    const leave = new LeaveRequestService(orm.em, scope, resolution, null as never, guard);
    const submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      null as never,
      null as never,
      null as never,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    const claims = new OvertimeClaimService(orm.em, scope, submit, guard);
    days = new AttendanceDayService(orm.em, scope, resolution, leave, guard);
    periods = new AttendancePeriodService(orm.em, scope, leave, claims);
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
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  const asHr = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId, userId, grants: [] }, fn);

  it('declares a period and reports its range as entirely uncomputed', async () => {
    const period = await asHr(() =>
      periods.declare({ code: CODE, periodStart: FROM, periodEnd: TO }),
    );
    periodId = period.id;

    const c = await asHr(() => periods.coverage(periodId));
    expect(c.missingEmployeeDays).toBe(c.expectedEmployeeDays);
    expect(c.staleEmployeeDays).toBe(0);
    // eslint-disable-next-line no-console
    console.log(
      'COVERAGE',
      `${CODE} ${FROM}..${TO}: expected=${c.expectedEmployeeDays} computed=${c.computedEmployeeDays}`,
      `missing=${c.missingEmployeeDays} stale=${c.staleEmployeeDays}`,
    );
  });

  it('recomputes the whole company across the range in one action', async () => {
    // The gap this slice closed: before it, this was one request per day, fired by hand.
    const written = await asHr(() => days.recomputeCompanyRange(FROM, TO));
    expect(written).toBeGreaterThan(0);

    const c = await asHr(() => periods.coverage(periodId));
    expect(c.missingEmployeeDays).toBe(0);
    // eslint-disable-next-line no-console
    console.log('RECOMP  ', `${written} employee-days written; missing now ${c.missingEmployeeDays}`);
  });

  it('reports a day as stale once a punch lands after it was computed', async () => {
    const em = orm.em.fork();
    em.create(AttendanceEvent, {
      company: em.getReference(Company, companyId),
      employee: em.getReference(Employee, employeeId),
      occurredAt: new Date(`${FROM}T02:00:00Z`),
      localDate: FROM,
      direction: AttendanceDirection.IN,
      source: AttendanceSource.WEB,
      geofenceStatus: 'UNKNOWN' as never,
      remark: 'hr verification',
      createdAt: new Date(Date.now() + 60_000),
    });
    await em.flush();

    const c = await asHr(() => periods.coverage(periodId));
    expect(c.staleEmployeeDays).toBeGreaterThan(0);
    // Stale is not missing: the row exists, it is just behind the ledger.
    expect(c.missingEmployeeDays).toBe(0);
    // eslint-disable-next-line no-console
    console.log('STALE   ', `missing=${c.missingEmployeeDays} stale=${c.staleEmployeeDays} — two figures, two meanings`);
  });

  it('closes, and the lines match the days they summarise', async () => {
    await asHr(() => days.recomputeCompanyRange(FROM, TO));
    await asHr(() => periods.close(periodId));

    const lines = await asHr(() => periods.lines(periodId));
    const line = lines.find((l) => l.employee.id === employeeId);
    const em = orm.em.fork();
    const daysIn = await em.find(
      AttendanceDay,
      { employee: employeeId, shiftDate: { $gte: FROM, $lte: TO } },
      FILTER_OFF,
    );
    const workedFromDays = daysIn.reduce((a, d) => a + d.workedMinutes, 0);
    expect(line!.workedMinutes).toBe(workedFromDays);
    // eslint-disable-next-line no-console
    console.log(
      'CLOSE   ',
      `${lines.length} lines; ${employeeId.slice(0, 8)} worked=${line!.workedMinutes}m`,
      `present=${line!.daysPresent} absent=${line!.daysAbsent} stamped ${line!.employmentType}`,
    );
  });

  it('reopens with a reason, re-closes, and leaves three log rows', async () => {
    await asHr(() => periods.reopen(periodId, { reason: 'HR verification of the reopen path' }));
    await asHr(() => periods.close(periodId));
    const log = await asHr(() => periods.log(periodId));
    expect(log.map((l) => l.action)).toEqual(['CLOSE', 'REOPEN', 'CLOSE']);
    expect(log[1].reason).toBeTruthy();
    expect(log.every((l) => !!l.actedBy)).toBe(true);
    // eslint-disable-next-line no-console
    console.log('LOG     ', log.map((l) => `${l.action}${l.reason ? `(${l.reason})` : ''}`).join(' -> '));
  });

  it('reads punches inside closed periods as a page with its total', async () => {
    const page = await asHr(() => periods.eventsInClosedPeriods({ page: 1, limit: 5 }));
    expect(page).toHaveProperty('total');
    expect(page.items.length).toBeLessThanOrEqual(5);
    // A capped list that does not report its cap reads as a complete one.
    // eslint-disable-next-line no-console
    console.log('CLOSEDEV', `page of ${page.items.length}, total ${page.total} — the total is the point`);
  });

  it('records a punch on behalf, stamped MANUAL with the actor', async () => {
    const em = orm.em.fork();
    const period = await em.findOne(AttendancePeriod, { id: periodId }, FILTER_OFF);
    // Outside the closed range, so this is a punch not a refusal.
    const at = new Date('2027-04-02T02:00:00Z');
    expect(period!.status).toBe(AttendancePeriodStatus.CLOSED);

    await asHr(() =>
      capture.punchFor({
        employeeId,
        occurredAt: at.toISOString(),
        direction: AttendanceDirection.IN,
        remark: 'entered by HR',
      } as never),
    );

    const [latest] = await orm.em.fork().find(
      AttendanceEvent,
      { employee: employeeId, occurredAt: at },
      { ...FILTER_OFF, populate: ['recordedBy'] },
    );
    expect(latest.source).toBe(AttendanceSource.MANUAL);
    expect(latest.recordedBy?.id).toBe(userId);
    // eslint-disable-next-line no-console
    console.log('ONBEHALF', `${latest.source} at ${latest.occurredAt.toISOString()} recorded_by=${latest.recordedBy?.id.slice(0, 8)}`);
  });

  it('corrects somebody else punch, with the subject on the DOCUMENT', async () => {
    const shiftDate = '2027-04-02';
    const options = await asHr(() => corrections.correctablePunches(employeeId, shiftDate));
    expect(options.length).toBeGreaterThan(0);
    const picked = options[0];

    const em = orm.em.fork();
    const dt = await em.findOne(DocumentType, { company: companyId, code: 'TCORR' }, FILTER_OFF);
    const tmpl = await em.findOne(FormTemplate, { documentType: dt!.id }, FILTER_OFF);
    const wf = await em.findOne(Workflow, { company: companyId, isActive: true }, FILTER_OFF);
    const employee = await em.findOne(Employee, { id: employeeId }, { ...FILTER_OFF, populate: ['department'] });
    const doc = em.create(Document, {
      docNo: `HR-${Date.now()}`,
      company: em.getReference(Company, companyId),
      department: em.getReference(Department, employee!.department.id),
      documentType: dt!,
      formTemplate: tmpl!,
      workflow: wf!,
      createdBy: em.getReference(AppUser, userId),
      // The subject rides HERE, where every approver sees it — not in the request body.
      relatedEmployee: em.getReference(Employee, employeeId),
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    const fields = await em.find(FormField, { formTemplate: tmpl!.id, isRequired: true }, FILTER_OFF);
    for (const field of fields) {
      em.create(DocFieldValue, { document: doc, formField: field, fieldValue: 'verification' });
    }
    await em.flush();

    const correction = await asHr(() =>
      corrections.create({
        documentId: doc.id,
        shiftDate,
        kind: CorrectionKind.REMOVE,
        targetEventId: picked.id,
        reason: 'HR verification of the on-behalf path',
      } as never),
    );

    const stored = await orm.em
      .fork()
      .findOne(TimeCorrection, { id: correction.id }, { ...FILTER_OFF, populate: ['employee', 'targetEvent'] });
    expect(stored!.employee.id).toBe(employeeId);
    expect(stored!.targetEvent?.id).toBe(picked.id);
    // eslint-disable-next-line no-console
    console.log(
      'CORRECT ',
      `subject ${stored!.employee.id.slice(0, 8)} resolved from the document; target ${picked.id.slice(0, 8)}`,
    );
  });
});
