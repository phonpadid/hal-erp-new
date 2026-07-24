import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  AttendanceDayStatus,
  AttendanceDirection,
  AttendancePeriodStatus,
  AttendanceSource,
  CorrectionKind,
  DocCategory,
  DocStatus,
  GeofenceStatus,
  LeaveHalf,
  PeriodAction,
} from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Workflow } from '../approval/approval.entities';
import { Currency } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { DocumentSubmitService } from '../document/document-submit.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService } from '../quota/quota-usage.service';
import { Quota } from '../quota/quota.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import {
  AttendanceDay,
  AttendanceEvent,
  AttendancePeriod,
  AttendancePeriodLeave,
  AttendancePeriodLine,
  AttendancePeriodLog,
  LeaveRequest,
  OvertimeClaim,
} from './attendance.entities';
import { AttendanceDayService } from './attendance-day.service';
import { AttendancePeriodGuard } from './attendance-period.guard';
import { AttendancePeriodService } from './attendance-period.service';
import { LeaveRequestService } from './leave-request.service';
import { OvertimeClaimService } from './overtime-claim.service';
import { ShiftResolutionService } from './shift-resolution.service';
import { TimeCorrectionService } from './time-correction.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

// July 2026 as a calendar month, and the payroll cut-off that runs across it.
const JULY = { code: '2026-07', periodStart: '2026-07-01', periodEnd: '2026-07-31' };

describe.skipIf(!hasDb)('AttendancePeriodService (DB-backed)', () => {
  let orm: MikroORM;
  let periods: AttendancePeriodService;
  let guard: AttendancePeriodGuard;
  let days: AttendanceDayService;
  let corrections: TimeCorrectionService;
  let leaveService: LeaveRequestService;
  let claims: OvertimeClaimService;
  let companyA = '';
  let deptA = '';
  let deptNoPay = '';
  let docTypeId = '';
  let templateId = '';
  let workflowId = '';
  let userId = '';
  let sickQuota = '';
  let annualQuota = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    guard = new AttendancePeriodGuard(orm.em);
    leaveService = new LeaveRequestService(orm.em, scope, resolution, null as never, guard);
    const submit = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      null as never,
      null as never,
      null as never,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    claims = new OvertimeClaimService(orm.em, scope, submit, guard);
    days = new AttendanceDayService(orm.em, scope, resolution, leaveService, guard);
    corrections = new TimeCorrectionService(orm.em, scope, resolution, guard);
    periods = new AttendancePeriodService(orm.em, scope, leaveService, claims);

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, {
      code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true,
      timezone: 'Asia/Bangkok', createdAt: new Date(),
    });
    const d = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    // A department whose attendance is watched for discipline but never drives pay.
    const dn = em.create(Department, {
      company: a, deptCode: 'DN', name: 'DN', isActive: true, attendanceAffectsPay: false,
    });
    const u = em.create(AppUser, { username: 'period-user', email: 'period@x.local', status: 'ACTIVE' });
    const dt = em.create(DocumentType, {
      company: a, code: 'PERIODTEST', name: 'Period fixture', category: DocCategory.HR,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      requiresPayee: false, requiresWarehouse: false, isActive: true,
    } as never);
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, isActive: true } as never);
    const wf = em.create(Workflow, { company: a, name: 'P WF', isActive: true } as never);
    em.create(FiscalYear, { company: a, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const sick = em.create(Quota, {
      company: a, quotaType: 'SICK_LEAVE', unit: 'day', limitValue: '90.00', resetCycle: 'YEARLY', isActive: true,
    });
    const annual = em.create(Quota, {
      company: a, quotaType: 'ANNUAL_LEAVE', unit: 'day', limitValue: '6.00', resetCycle: 'YEARLY', isActive: true,
    });
    await em.flush();
    companyA = a.id; deptA = d.id; deptNoPay = dn.id; userId = u.id;
    docTypeId = dt.id; templateId = tmpl.id; workflowId = wf.id;
    sickQuota = sick.id; annualQuota = annual.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ companyId: companyA, userId, grants: [] }, fn);

  async function freshEmployee(opts: { departmentId?: string; affectsPay?: boolean | null } = {}) {
    const em = orm.em.fork();
    const emp = em.create(Employee, {
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, opts.departmentId ?? deptA),
      empCode: `E${seq++}`,
      fullName: 'Fixture',
      status: 'ACTIVE',
      ...(opts.affectsPay === undefined ? {} : { attendanceAffectsPay: opts.affectsPay ?? undefined }),
    });
    await em.flush();
    return emp.id;
  }

  /** A computed day written directly, so a fixture controls the figures it will be summarised from. */
  async function dayWith(
    employeeId: string,
    shiftDate: string,
    m: Partial<{
      status: AttendanceDayStatus;
      expected: number;
      worked: number;
      lateMinutes: number;
      lateOccurrences: number;
      earlyLeave: number;
      otNormal: number;
      holidayWork: number;
      otHoliday: number;
    }> = {},
  ) {
    const em = orm.em.fork();
    em.create(AttendanceDay, {
      company: em.getReference(Company, companyA),
      employee: em.getReference(Employee, employeeId),
      shiftDate,
      status: m.status ?? AttendanceDayStatus.PRESENT,
      expectedMinutes: m.expected ?? 480,
      workedMinutes: m.worked ?? 480,
      lateMinutes: m.lateMinutes ?? 0,
      lateOccurrences: m.lateOccurrences ?? 0,
      earlyLeaveMinutes: m.earlyLeave ?? 0,
      otNormalMinutes: m.otNormal ?? 0,
      holidayWorkMinutes: m.holidayWork ?? 0,
      otHolidayMinutes: m.otHoliday ?? 0,
      computedAt: new Date(),
    });
    await em.flush();
  }

  async function draft(subjectEmployeeId?: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `P-${seq++}`,
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptA),
      documentType: em.getReference(DocumentType, docTypeId),
      formTemplate: em.getReference(FormTemplate, templateId),
      workflow: em.getReference(Workflow, workflowId),
      createdBy: em.getReference(AppUser, userId),
      ...(subjectEmployeeId
        ? { relatedEmployee: em.getReference(Employee, subjectEmployeeId) }
        : {}),
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  /** An APPROVED leave over a range, written directly — the approval path has its own spec. */
  async function approvedLeave(
    employeeId: string,
    quotaId: string,
    fromDate: string,
    toDate: string,
    fromHalf = LeaveHalf.FULL,
    toHalf = LeaveHalf.FULL,
  ) {
    const documentId = await draft();
    const em = orm.em.fork();
    const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    doc!.status = DocStatus.APPROVED;
    em.create(LeaveRequest, {
      document: doc!,
      quota: em.getReference(Quota, quotaId),
      employee: em.getReference(Employee, employeeId),
      fromDate, toDate, fromHalf, toHalf, totalDays: '1.00',
    });
    await em.flush();
  }

  /** An APPROVED overtime claim over a range, written directly. */
  async function approvedClaim(employeeId: string, fromDate: string, toDate: string) {
    const documentId = await draft();
    const em = orm.em.fork();
    const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    doc!.status = DocStatus.APPROVED;
    em.create(OvertimeClaim, {
      company: em.getReference(Company, companyA),
      document: doc!,
      employee: em.getReference(Employee, employeeId),
      fromDate, toDate,
      otNormalMinutes: 0, holidayWorkMinutes: 0, otHolidayMinutes: 0,
    });
    await em.flush();
  }

  async function declareJuly(over: Partial<typeof JULY> = {}) {
    return asA(() => periods.declare({ ...JULY, code: `${JULY.code}-${seq++}`, ...over }));
  }

  /** Remove every period so the next test starts from a company that has declared none. */
  async function clearPeriods() {
    const em = orm.em.fork();
    await em.nativeDelete(AttendancePeriod, {}, FILTER_OFF);
  }

  const lineFor = async (periodId: string, employeeId: string) =>
    orm.em.fork().findOne(
      AttendancePeriodLine,
      { period: periodId, employee: employeeId },
      FILTER_OFF,
    );

  describe('declaring a period', () => {
    it('stores a calendar month exactly as given', async () => {
      await clearPeriods();
      const period = await declareJuly();
      expect(period.periodStart).toBe('2026-07-01');
      expect(period.periodEnd).toBe('2026-07-31');
      expect(period.status).toBe(AttendancePeriodStatus.DRAFT);
    });

    it('stores a 26th-to-25th payroll cut-off exactly as given', async () => {
      await clearPeriods();
      // The reason the range is explicit dates rather than a year and a month: this cut-off is the
      // common case in Thai payroll, not an exotic one, and a month could never express it.
      const period = await declareJuly({ periodStart: '2026-06-26', periodEnd: '2026-07-25' });
      expect(period.periodStart).toBe('2026-06-26');
      expect(period.periodEnd).toBe('2026-07-25');
    });

    it('rejects a period overlapping an existing one', async () => {
      await clearPeriods();
      await declareJuly();
      await expect(declareJuly({ periodStart: '2026-07-20', periodEnd: '2026-08-20' })).rejects.toThrow(
        /overlaps period/i,
      );
    });

    it('allows a gap between periods', async () => {
      await clearPeriods();
      await declareJuly({ periodStart: '2026-06-01', periodEnd: '2026-06-30' });
      const august = await declareJuly({ periodStart: '2026-08-01', periodEnd: '2026-08-31' });
      expect(august.id).toBeTruthy();
      // Nothing in July belongs to any period.
      expect(await guard.closedPeriodOn(companyA, '2026-07-15')).toBeNull();
    });

    it('rejects a reversed range', async () => {
      await clearPeriods();
      await expect(declareJuly({ periodStart: '2026-07-31', periodEnd: '2026-07-01' })).rejects.toThrow(
        /must not precede/i,
      );
    });

    it('refuses to edit a closed period', async () => {
      await clearPeriods();
      const period = await declareJuly();
      await asA(() => periods.close(period.id));
      await expect(asA(() => periods.update(period.id, { code: 'renamed' }))).rejects.toThrow(
        /is closed/i,
      );
    });

    it('leaves exactly one period when two overlapping declarations race', async () => {
      await clearPeriods();
      const results = await Promise.allSettled([
        declareJuly({ periodStart: '2026-07-01', periodEnd: '2026-07-31' }),
        declareJuly({ periodStart: '2026-07-15', periodEnd: '2026-08-15' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const all = await orm.em.fork().find(AttendancePeriod, {}, FILTER_OFF);
      expect(all).toHaveLength(1);
    });
  });

  describe('closing', () => {
    it('writes one line per employee and flips the status', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      await dayWith(employeeId, '2026-07-01');
      const period = await declareJuly();

      const closed = await asA(() => periods.close(period.id));
      expect(closed.status).toBe(AttendancePeriodStatus.CLOSED);

      const employees = await orm.em.fork().find(Employee, { company: companyA }, FILTER_OFF);
      const lines = await orm.em.fork().find(AttendancePeriodLine, { period: period.id }, FILTER_OFF);
      expect(lines).toHaveLength(employees.length);
    });

    it('carries late minutes and late occurrences as two figures', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) {
        await dayWith(employeeId, d, { lateMinutes: 10, lateOccurrences: 1 });
      }
      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      const line = await lineFor(period.id, employeeId);
      expect(line!.lateMinutes).toBe(30);
      expect(line!.lateOccurrences).toBe(3);
    });

    it('certifies only the in-period dates of a straddling claim', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      await dayWith(employeeId, '2026-07-24', { otNormal: 60 });
      await dayWith(employeeId, '2026-07-25', { otNormal: 90 });
      await dayWith(employeeId, '2026-07-26', { otNormal: 120 });
      await approvedClaim(employeeId, '2026-07-24', '2026-07-27');

      // A period ending on the 25th: the claim reaches past it, and only its first two days count.
      const period = await declareJuly({ periodStart: '2026-07-01', periodEnd: '2026-07-25' });
      await asA(() => periods.close(period.id));

      const line = await lineFor(period.id, employeeId);
      expect(line!.otNormalMinutes).toBe(150);
      expect(line!.uncertifiedOtMinutes).toBe(0);
    });

    it('reports overtime nobody claimed as one uncertified total', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      await dayWith(employeeId, '2026-07-01', { otNormal: 60, holidayWork: 480, otHoliday: 120 });
      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      const line = await lineFor(period.id, employeeId);
      expect(line!.uncertifiedOtMinutes).toBe(660);
      expect(line!.otNormalMinutes).toBe(0);
      expect(line!.holidayWorkMinutes).toBe(0);
      expect(line!.otHolidayMinutes).toBe(0);
    });

    it('carries leave days by type, with no paid classification', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      await dayWith(employeeId, '2026-07-06', { status: AttendanceDayStatus.LEAVE, worked: 0 });
      await dayWith(employeeId, '2026-07-07', { status: AttendanceDayStatus.LEAVE, worked: 0 });
      await dayWith(employeeId, '2026-07-08', { status: AttendanceDayStatus.LEAVE, worked: 0 });
      await approvedLeave(employeeId, sickQuota, '2026-07-06', '2026-07-07');
      await approvedLeave(employeeId, annualQuota, '2026-07-08', '2026-07-08');

      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      const line = await lineFor(period.id, employeeId);
      const leaveRows = await orm.em.fork().find(
        AttendancePeriodLeave,
        { line: line!.id },
        { ...FILTER_OFF, populate: ['quota'] },
      );
      const byQuota = new Map(leaveRows.map((r) => [r.quota.id, r.days]));
      expect(byQuota.get(sickQuota)).toBe('2.00');
      expect(byQuota.get(annualQuota)).toBe('1.00');
      // The paid boundary is an annual cumulative rule, so it is deliberately not decided here.
      expect(Object.keys(leaveRows[0])).not.toContain('isPaid');
    });

    it('counts a half day of leave as half of that day', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      // A Saturday running 08:00-12:00: half of it is half of four hours, not half of eight.
      await dayWith(employeeId, '2026-07-04', { expected: 240, worked: 120 });
      await approvedLeave(employeeId, annualQuota, '2026-07-04', '2026-07-04', LeaveHalf.AM, LeaveHalf.AM);

      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      const line = await lineFor(period.id, employeeId);
      const [row] = await orm.em.fork().find(AttendancePeriodLeave, { line: line!.id }, FILTER_OFF);
      expect(row.days).toBe('0.50');
    });

    it('stamps the pay basis rather than reading it live', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      await dayWith(employeeId, '2026-07-01');
      const period = await declareJuly();
      await asA(() => periods.close(period.id));
      expect((await lineFor(period.id, employeeId))!.employmentType).toBe('MONTHLY');

      const em = orm.em.fork();
      const emp = await em.findOne(Employee, { id: employeeId }, FILTER_OFF);
      emp!.employmentType = 'DAILY' as never;
      await em.flush();

      // A figure produced from a closed period must not change meaning because somebody edited
      // configuration afterwards.
      expect((await lineFor(period.id, employeeId))!.employmentType).toBe('MONTHLY');
    });

    it('refuses to close a period twice', async () => {
      await clearPeriods();
      const period = await declareJuly();
      await asA(() => periods.close(period.id));
      await expect(asA(() => periods.close(period.id))).rejects.toThrow(/already closed/i);
    });

    it('leaves one complete set of lines when two closes race', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      await dayWith(employeeId, '2026-07-01');
      const period = await declareJuly();

      const results = await Promise.allSettled([
        asA(() => periods.close(period.id)),
        asA(() => periods.close(period.id)),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const employees = await orm.em.fork().find(Employee, { company: companyA }, FILTER_OFF);
      const lines = await orm.em.fork().find(AttendancePeriodLine, { period: period.id }, FILTER_OFF);
      expect(lines).toHaveLength(employees.length);
    });
  });

  describe('whether attendance drives pay', () => {
    it('inherits the department when the employee says nothing', async () => {
      await clearPeriods();
      const inherits = await freshEmployee({ departmentId: deptNoPay });
      await dayWith(inherits, '2026-07-01');
      const period = await declareJuly();
      await asA(() => periods.close(period.id));
      expect((await lineFor(period.id, inherits))!.attendanceAffectsPay).toBe(false);
    });

    it('lets a person override their department', async () => {
      await clearPeriods();
      const overridden = await freshEmployee({ departmentId: deptA, affectsPay: false });
      const colleague = await freshEmployee({ departmentId: deptA });
      await dayWith(overridden, '2026-07-01');
      await dayWith(colleague, '2026-07-01');
      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      expect((await lineFor(period.id, overridden))!.attendanceAffectsPay).toBe(false);
      expect((await lineFor(period.id, colleague))!.attendanceAffectsPay).toBe(true);
    });

    it('changes not a single attendance figure', async () => {
      await clearPeriods();
      const paid = await freshEmployee({ departmentId: deptA });
      const unpaid = await freshEmployee({ departmentId: deptNoPay });
      for (const e of [paid, unpaid]) {
        await dayWith(e, '2026-07-01', { lateMinutes: 12, lateOccurrences: 1, earlyLeave: 5 });
      }
      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      const a = (await lineFor(period.id, paid))!;
      const b = (await lineFor(period.id, unpaid))!;
      expect(b.lateMinutes).toBe(a.lateMinutes);
      expect(b.lateOccurrences).toBe(a.lateOccurrences);
      expect(b.earlyLeaveMinutes).toBe(a.earlyLeaveMinutes);
      expect(b.workedMinutes).toBe(a.workedMinutes);
      expect(b.attendanceAffectsPay).not.toBe(a.attendanceAffectsPay);
    });
  });

  describe('a closed period freezes the projection', () => {
    it('refuses a recomputation of a closed date', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      await expect(asA(() => days.recomputeDay(employeeId, '2026-07-15'))).rejects.toThrow(
        /closed period/i,
      );
    });

    it('recomputes only the open dates of a straddling range', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      const period = await declareJuly({ periodStart: '2026-07-01', periodEnd: '2026-07-25' });
      await asA(() => periods.close(period.id));

      const rows = await asA(() => days.recomputeRange(employeeId, '2026-07-24', '2026-07-27'));
      expect(rows.map((r) => r.shiftDate).sort()).toEqual(['2026-07-26', '2026-07-27']);
    });

    it('still records a punch for a closed day', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      const em = orm.em.fork();
      const at = new Date('2026-07-15T08:00:00+07:00');
      em.create(AttendanceEvent, {
        company: em.getReference(Company, companyA),
        employee: em.getReference(Employee, employeeId),
        occurredAt: at,
        localDate: '2026-07-15',
        direction: AttendanceDirection.IN,
        source: AttendanceSource.WEB,
        geofenceStatus: GeofenceStatus.UNKNOWN,
        createdAt: new Date(),
      });
      await em.flush();

      // The ledger never refuses truth. It just does not move a frozen number.
      const found = await asA(() => periods.eventsInClosedPeriods());
      expect(found.map((e) => e.localDate)).toContain('2026-07-15');
    });

    it('rejects a correction into a closed period, naming it', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      const period = await declareJuly();
      await asA(() => periods.close(period.id));

      const documentId = await draft(employeeId);
      await expect(
        asA(() =>
          corrections.create({
            documentId, shiftDate: '2026-07-15', kind: CorrectionKind.ADD,
            requestedAt: new Date('2026-07-15T17:00:00+07:00').toISOString(),
            requestedDirection: AttendanceDirection.OUT,
            reason: 'Into a closed month',
          }),
        ),
      ).rejects.toThrow(new RegExp(period.code));
    });

    it('rejects leave straddling the close in full', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      const period = await declareJuly({ periodStart: '2026-07-01', periodEnd: '2026-07-25' });
      await asA(() => periods.close(period.id));

      const documentId = await draft();
      await expect(
        asA(() =>
          leaveService.create({
            documentId, quotaId: sickQuota, fromDate: '2026-07-24', toDate: '2026-07-27',
            fromHalf: LeaveHalf.FULL, toHalf: LeaveHalf.FULL,
          } as never),
        ),
      ).rejects.toThrow(/closed period/i);
    });

    it('rejects an overtime claim reaching into a closed period', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      await dayWith(employeeId, '2026-07-26', { otNormal: 60 });
      const period = await declareJuly({ periodStart: '2026-07-01', periodEnd: '2026-07-25' });
      await asA(() => periods.close(period.id));

      const documentId = await draft();
      await expect(
        asA(() => claims.create({ documentId, employeeId, fromDate: '2026-07-24', toDate: '2026-07-27' })),
      ).rejects.toThrow(/closed period/i);
    });

    it('changes nothing for a company that declared no period', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      const row = await asA(() => days.recomputeDay(employeeId, '2026-07-15'));
      expect(row.shiftDate).toBe('2026-07-15');
      expect(await asA(() => periods.eventsInClosedPeriods())).toEqual([]);
    });
  });

  describe('reopening', () => {
    it('records the action, the actor and the reason', async () => {
      await clearPeriods();
      const period = await declareJuly();
      await asA(() => periods.close(period.id));
      const reopened = await asA(() => periods.reopen(period.id, { reason: 'A correction surfaced' }));
      expect(reopened.status).toBe(AttendancePeriodStatus.DRAFT);

      const log = await asA(() => periods.log(period.id));
      expect(log.map((l) => l.action)).toEqual([PeriodAction.CLOSE, PeriodAction.REOPEN]);
      expect(log[1].reason).toBe('A correction surfaced');
      expect(log[1].actedBy.id).toBe(userId);
    });

    it('requires a reason', async () => {
      await clearPeriods();
      const period = await declareJuly();
      await asA(() => periods.close(period.id));
      await expect(asA(() => periods.reopen(period.id, { reason: '   ' }))).rejects.toThrow(
        /requires a reason/i,
      );
      const still = await orm.em.fork().findOne(AttendancePeriod, { id: period.id }, FILTER_OFF);
      expect(still!.status).toBe(AttendancePeriodStatus.CLOSED);
    });

    it('refuses to update a log row', async () => {
      await clearPeriods();
      const period = await declareJuly();
      await asA(() => periods.close(period.id));
      const em = orm.em.fork();
      const row = await em.findOne(AttendancePeriodLog, { period: period.id }, FILTER_OFF);
      row!.reason = 'rewritten';
      await expect(em.flush()).rejects.toThrow(/append-only/i);
    });

    it('replaces the lines when a reopened period is closed again', async () => {
      await clearPeriods();
      const employeeId = await freshEmployee();
      await dayWith(employeeId, '2026-07-01', { worked: 300 });
      const period = await declareJuly();
      await asA(() => periods.close(period.id));
      expect((await lineFor(period.id, employeeId))!.workedMinutes).toBe(300);

      await asA(() => periods.reopen(period.id, { reason: 'The day was wrong' }));
      // What a correction and a recompute would have produced.
      const em = orm.em.fork();
      const day = await em.findOne(AttendanceDay, { employee: employeeId, shiftDate: '2026-07-01' }, FILTER_OFF);
      day!.workedMinutes = 480;
      await em.flush();

      await asA(() => periods.close(period.id));
      expect((await lineFor(period.id, employeeId))!.workedMinutes).toBe(480);

      const lines = await orm.em.fork().find(AttendancePeriodLine, { period: period.id }, FILTER_OFF);
      const employees = await orm.em.fork().find(Employee, { company: companyA }, FILTER_OFF);
      expect(lines).toHaveLength(employees.length);

      const log = await asA(() => periods.log(period.id));
      expect(log.map((l) => l.action)).toEqual([
        PeriodAction.CLOSE,
        PeriodAction.REOPEN,
        PeriodAction.CLOSE,
      ]);
    });
  });
});
