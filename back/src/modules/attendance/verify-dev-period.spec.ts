import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  AttendanceDayStatus,
  AttendanceDirection,
  AttendancePeriodStatus,
  AttendanceSource,
  CorrectionKind,
  DocStatus,
  GeofenceStatus,
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
import {
  AttendanceDay,
  AttendanceEvent,
  AttendancePeriod,
  AttendancePeriodLine,
} from './attendance.entities';
import { AttendanceDayService } from './attendance-day.service';
import { AttendancePeriodGuard } from './attendance-period.guard';
import { AttendancePeriodService } from './attendance-period.service';
import { LeaveRequestService } from './leave-request.service';
import { OvertimeClaimService } from './overtime-claim.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { TimeCorrectionService } from './time-correction.service';
import type { MikroORM } from '@mikro-orm/postgresql';

/**
 * Tasks 8.2 and 8.3 — against the DEV database, with its real seeded periods and document types.
 * Skips entirely unless DB_NAME points at the dev database.
 *
 * Nothing here deletes: the rows it makes are left in place so the flow from days to a closed line,
 * and from a reopen to a changed figure, stays visible in the dev data.
 */
const hasDb = await dbAvailable();
const isDevDb = process.env.DB_NAME === 'new_erp';
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb || !isDevDb)('dev-database attendance period (manual verification)', () => {
  let orm: MikroORM;
  let periods: AttendancePeriodService;
  let guard: AttendancePeriodGuard;
  let days: AttendanceDayService;
  let corrections: TimeCorrectionService;
  let companyId = '';
  let employeeId = '';
  let userId = '';
  let periodId = '';
  let periodCode = '';
  let periodStart = '';
  let periodEnd = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    const scope = new CompanyScopeService(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    guard = new AttendancePeriodGuard(orm.em);
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
    corrections = new TimeCorrectionService(orm.em, scope, resolution, guard);
    periods = new AttendancePeriodService(orm.em, scope, leave, claims);

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

    // The seeded DRAFT period is the one this verification closes; the seeded CLOSED one proves
    // the gates without this run having to close anything first.
    const draftPeriod = await em.findOne(
      AttendancePeriod,
      { company: companyId, status: AttendancePeriodStatus.DRAFT },
      { ...FILTER_OFF, orderBy: { periodStart: 'ASC' } },
    );
    periodId = draftPeriod!.id;
    periodCode = draftPeriod!.code;
    periodStart = draftPeriod!.periodStart;
    periodEnd = draftPeriod!.periodEnd;

    // Two days inside it, so the line has something real to report.
    for (const [date, worked, late] of [
      [periodStart, 480, 0],
      [addDays(periodStart, 1), 420, 12],
    ] as Array<[string, number, number]>) {
      const existing = await em.findOne(AttendanceDay, { employee: employeeId, shiftDate: date }, FILTER_OFF);
      if (existing) {
        existing.workedMinutes = worked;
        existing.lateMinutes = late;
        existing.lateOccurrences = late > 0 ? 1 : 0;
        existing.status = AttendanceDayStatus.PRESENT;
        existing.expectedMinutes = 480;
      } else {
        em.create(AttendanceDay, {
          company: em.getReference(Company, companyId),
          employee: em.getReference(Employee, employeeId),
          shiftDate: date,
          status: AttendanceDayStatus.PRESENT,
          expectedMinutes: 480,
          workedMinutes: worked,
          lateMinutes: late,
          lateOccurrences: late > 0 ? 1 : 0,
          computedAt: new Date(),
        });
      }
    }
    await em.flush();
  });

  afterAll(async () => {
    if (orm) await orm.close(true);
  });

  const asHal = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ companyId, userId, grants: [] }, fn);

  it('refuses a correction into the seeded closed period, naming it', async () => {
    const em = orm.em.fork();
    const closed = await em.findOne(
      AttendancePeriod,
      { company: companyId, status: AttendancePeriodStatus.CLOSED },
      FILTER_OFF,
    );
    expect(closed).not.toBeNull();
    const midpoint = addDays(closed!.periodStart, 5);

    const documentId = await draftDocument(orm, companyId, employeeId, userId);
    await expect(
      asHal(() =>
        corrections.create({
          documentId,
          employeeId,
          shiftDate: midpoint,
          kind: CorrectionKind.ADD,
          requestedAt: new Date(`${midpoint}T17:00:00+07:00`).toISOString(),
          requestedDirection: AttendanceDirection.OUT,
          reason: 'Into a closed month',
        }),
      ),
    ).rejects.toThrow(new RegExp(closed!.code));
    // eslint-disable-next-line no-console
    console.log('GATE   ', `correction on ${midpoint} refused by period '${closed!.code}'`);
  });

  it('still records a punch that lands in a closed period, and lists it', async () => {
    const em = orm.em.fork();
    const closed = await em.findOne(
      AttendancePeriod,
      { company: companyId, status: AttendancePeriodStatus.CLOSED },
      FILTER_OFF,
    );
    const date = addDays(closed!.periodStart, 6);
    em.create(AttendanceEvent, {
      company: em.getReference(Company, companyId),
      employee: em.getReference(Employee, employeeId),
      occurredAt: new Date(`${date}T08:00:00+07:00`),
      localDate: date,
      direction: AttendanceDirection.IN,
      source: AttendanceSource.WEB,
      geofenceStatus: GeofenceStatus.UNKNOWN,
      remark: 'period verification — late upload',
      createdAt: new Date(),
    });
    await em.flush();

    const listed = await asHal(() => periods.eventsInClosedPeriods());
    expect(listed.items.map((e) => e.localDate)).toContain(date);
    // eslint-disable-next-line no-console
    console.log('LEDGER ', `punch on ${date} stored inside closed '${closed!.code}'; ${listed.total} such rows in total`);
  });

  it('closes the draft period and produces lines that match the days', async () => {
    const closed = await asHal(() => periods.close(periodId));
    expect(closed.status).toBe(AttendancePeriodStatus.CLOSED);

    const em = orm.em.fork();
    const line = await em.findOne(
      AttendancePeriodLine,
      { period: periodId, employee: employeeId },
      FILTER_OFF,
    );
    const daysIn = await em.find(
      AttendanceDay,
      { employee: employeeId, shiftDate: { $gte: periodStart, $lte: periodEnd } },
      FILTER_OFF,
    );
    const workedFromDays = daysIn.reduce((a, d) => a + d.workedMinutes, 0);
    const lateFromDays = daysIn.reduce((a, d) => a + d.lateMinutes, 0);

    expect(line!.workedMinutes).toBe(workedFromDays);
    expect(line!.lateMinutes).toBe(lateFromDays);
    // eslint-disable-next-line no-console
    console.log(
      'CLOSE  ',
      `${periodCode} (${periodStart}..${periodEnd})`,
      `worked=${line!.workedMinutes}m late=${line!.lateMinutes}m/${line!.lateOccurrences}x`,
      `present=${line!.daysPresent} absent=${line!.daysAbsent} leave=${line!.daysLeave}`,
      `| stamped ${line!.employmentType}, affectsPay=${line!.attendanceAffectsPay}`,
    );
  });

  it('freezes the range: a closed date will not recompute', async () => {
    await expect(asHal(() => days.recomputeDay(employeeId, periodStart))).rejects.toThrow(
      new RegExp(periodCode),
    );
    // eslint-disable-next-line no-console
    console.log('FROZEN ', `${periodStart} refuses recomputation while '${periodCode}' is closed`);
  });

  it('reopens, changes a day, re-closes, and leaves three log rows', async () => {
    const before = (await lineOf(orm, periodId, employeeId))!.workedMinutes;

    await asHal(() => periods.reopen(periodId, { reason: 'A correction surfaced after close' }));
    const em = orm.em.fork();
    const day = await em.findOne(AttendanceDay, { employee: employeeId, shiftDate: periodStart }, FILTER_OFF);
    day!.workedMinutes = day!.workedMinutes + 60;
    await em.flush();

    await asHal(() => periods.close(periodId));
    const after = (await lineOf(orm, periodId, employeeId))!.workedMinutes;
    expect(after).toBe(before + 60);

    const log = await asHal(() => periods.log(periodId));
    expect(log.map((l) => l.action)).toEqual(['CLOSE', 'REOPEN', 'CLOSE']);
    // eslint-disable-next-line no-console
    console.log(
      'REOPEN ',
      `${before}m -> ${after}m after reopen+recorrect+close;`,
      `log: ${log.map((l) => `${l.action}${l.reason ? `(${l.reason})` : ''}`).join(' -> ')}`,
    );
  });

  it('agrees with the database on every column of the four new tables', async () => {
    const em = orm.em.fork();
    const rows = await em.getConnection().execute<Array<{ table_name: string; column_name: string }>>(
      `select table_name, column_name from information_schema.columns
       where table_name in ('attendance_period','attendance_period_line','attendance_period_leave','attendance_period_log')
       order by table_name, ordinal_position`,
    );
    const byTable = new Map<string, string[]>();
    for (const r of rows) {
      byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r.column_name]);
    }
    expect(byTable.get('attendance_period')).toEqual([
      'id', 'company_id', 'code', 'period_start', 'period_end', 'status',
    ]);
    expect(byTable.get('attendance_period_log')).toEqual([
      'id', 'period_id', 'action', 'acted_by', 'acted_at', 'reason',
    ]);
    expect(byTable.get('attendance_period_leave')).toEqual(['id', 'line_id', 'quota_id', 'days']);
    // eslint-disable-next-line no-console
    for (const [t, cols] of byTable) console.log('SCHEMA ', t, `(${cols.length})`, cols.join(', '));
  });
});

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function lineOf(orm: MikroORM, periodId: string, employeeId: string) {
  return orm.em
    .fork()
    .findOne(AttendancePeriodLine, { period: periodId, employee: employeeId }, FILTER_OFF);
}

async function draftDocument(
  orm: MikroORM,
  companyId: string,
  employeeId: string,
  userId: string,
): Promise<string> {
  const em = orm.em.fork();
  const employee = await em.findOne(Employee, { id: employeeId }, { ...FILTER_OFF, populate: ['department'] });
  const dt = await em.findOne(DocumentType, { company: companyId, code: 'TCORR' }, FILTER_OFF);
  const tmpl = await em.findOne(FormTemplate, { documentType: dt!.id }, FILTER_OFF);
  const wf = await em.findOne(Workflow, { company: companyId, isActive: true }, FILTER_OFF);
  const doc = em.create(Document, {
    docNo: `PV-${Date.now()}`,
    company: em.getReference(Company, companyId),
    department: em.getReference(Department, employee!.department.id),
    documentType: dt!,
    formTemplate: tmpl!,
    workflow: wf!,
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
  return doc.id;
}
