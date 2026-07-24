import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import {
  AttendanceDayStatus,
  ControlPolicy,
  DocCategory,
  DocStatus,
  LeaveHalf,
} from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { Document, DocumentType, FormTemplate } from '../document/document.entities';
import { DocumentSubmitService } from '../document/document-submit.service';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FiscalYearService } from '../multi-company/fiscal-year.service';
import { FiscalYear } from '../multi-company/multi-company.entities';
import { Workflow } from '../approval/approval.entities';
import { Company, Department, HolidayCalendar } from '../multi-company/multi-company.entities';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { QuotaUsageService, type QuotaOvershoot } from '../quota/quota-usage.service';
import { Quota, QuotaEntitlement, QuotaUsage } from '../quota/quota.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDay, LeaveRequest, LeaveType, WorkShift } from './attendance.entities';
import { AttendanceDayService } from './attendance-day.service';
import { EmployeeShiftService } from './employee-shift.service';
import { LeaveRequestService } from './leave-request.service';
import { LeaveApprovedListener } from './leave-approved.listener';
import { ShiftResolutionService } from './shift-resolution.service';
import { WorkShiftService } from './work-shift.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

// 2026-03-02 Mon … 2026-03-07 Sat, 2026-03-08 Sun.
const MON = '2026-03-02';
const TUE = '2026-03-03';
const WED = '2026-03-04';
const THU = '2026-03-05';
const FRI = '2026-03-06';
const SAT = '2026-03-07';
const SUN = '2026-03-08';

const OFFICE = {
  name: 'Office',
  startTime: '08:00',
  endTime: '17:00',
  breakStartTime: '12:00',
  breakEndTime: '13:00',
  standardMinutes: 480,
  halfDayThresholdMinutes: 240,
};

describe.skipIf(!hasDb)('LeaveRequestService (DB-backed)', () => {
  let orm: MikroORM;
  let leave: LeaveRequestService;
  let days: AttendanceDayService;
  let quotaUsage: QuotaUsageService;
  let submitService: DocumentSubmitService;
  /** Leave that delegates to a recording double — the seam under test is the call, not submit. */
  let leaveWithSpy: LeaveRequestService;
  let delegated: Array<{ documentId: string; dto: unknown; opts: unknown }>;
  let balance: QuotaBalanceService;
  let companyA = '';
  let deptA = '';
  let docTypeId = '';
  let templateId = '';
  let workflowId = '';
  let annualQuotaId = '';
  let sickQuotaId = '';
  let userId = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    const resolution = new ShiftResolutionService(orm.em);
    leave = new LeaveRequestService(orm.em, scope, resolution, null as never);
    days = new AttendanceDayService(orm.em, scope, resolution, leave);
    balance = new QuotaBalanceService(orm.em);
    quotaUsage = new QuotaUsageService(orm.em, balance);
    // Fully wired for the paths this spec exercises. Vendor/item/budget stay null because the
    // leave type sets none of those flags, so submit never reaches them.
    submitService = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      null as never,
      null as never,
      null as never,
      quotaUsage,
    );
    leave = new LeaveRequestService(orm.em, scope, resolution, submitService);
    // LeaveRequestService's job is to compute the quantity and delegate correctly;
    // DocumentSubmitService's job is to submit. Testing the seam with a double keeps this spec
    // from re-testing the entire submit stack (FX, fiscal period, budget) that document-engine
    // already covers.
    delegated = [];
    const recorder = {
      submit: async (documentId: string, dto: unknown, opts: unknown) => {
        delegated.push({ documentId, dto, opts });
        return null as never;
      },
    } as unknown as DocumentSubmitService;
    leaveWithSpy = new LeaveRequestService(orm.em, scope, resolution, recorder);
    const shifts = new WorkShiftService(orm.em, scope);
    const assignments = new EmployeeShiftService(orm.em, scope);

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true, timezone: 'Asia/Bangkok', createdAt: new Date() });
    const d = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    const u = em.create(AppUser, { username: 'leaver', email: 'leaver@x.local', status: 'ACTIVE' });
    const dt = em.create(DocumentType, {
      company: a, code: 'LEAVE', name: 'Leave', category: DocCategory.HR,
      requiresBudget: false, requiresQuota: true, requiresVendor: false, requiresItem: false,
      requiresPayee: false, requiresWarehouse: false, isActive: true,
    } as never);
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, isActive: true } as never);
    const wf = em.create(Workflow, { company: a, name: 'Leave WF', isActive: true } as never);
    // Thursday is a company holiday — the case that makes counting more than date subtraction.
    em.create(HolidayCalendar, { company: a, holidayDate: THU, name: 'Test Holiday' });
    em.create(FiscalYear, { company: a, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    await em.flush();

    companyA = a.id; deptA = d.id; userId = u.id;
    docTypeId = dt.id; templateId = tmpl.id; workflowId = wf.id;

    const office = await asA(() => shifts.create({ ...OFFICE, code: 'OFFICE' }));
    // Mon-Fri full, Saturday a half day ending at 12:00 — the pattern the user's company runs.
    await asA(() =>
      shifts.setDays(office.id, {
        days: [...[1, 2, 3, 4, 5].map((weekday) => ({ weekday })), { weekday: 6, endTime: '12:00' }],
      }),
    );

    const em2 = orm.em.fork();
    const dept = await em2.findOne(Department, { id: deptA }, FILTER_OFF);
    dept!.defaultWorkShift = em2.getReference(WorkShift, office.id);
    // Annual leave: gone is gone. Sick leave: allowed past the paid ceiling, but flagged.
    const annual = em2.create(Quota, {
      company: em2.getReference(Company, companyA), quotaType: 'ANNUAL_LEAVE', unit: 'day',
      limitValue: '6.00', resetCycle: 'YEARLY', isActive: true,
    });
    const sick = em2.create(Quota, {
      company: em2.getReference(Company, companyA), quotaType: 'SICK_LEAVE', unit: 'day',
      limitValue: '90.00', paidLimitValue: '30.00', resetCycle: 'YEARLY',
      controlPolicy: ControlPolicy.SOFT_WARNING, isActive: true,
    });
    await em2.flush();
    annualQuotaId = annual.id; sickQuotaId = sick.id;
    void assignments;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  function asA<T>(fn: () => Promise<T>) {
    return RequestContext.run({ companyId: companyA, userId, grants: [] }, fn);
  }

  async function entitleFor(employeeId: string, quotaId: string, value: string) {
    const em = orm.em.fork();
    em.create(QuotaEntitlement, {
      quota: em.getReference(Quota, quotaId),
      employee: em.getReference(Employee, employeeId),
      year: 2026, entitledValue: value,
    } as never);
    await em.flush();
  }

  async function freshEmployee(): Promise<string> {
    const em = orm.em.fork();
    const emp = em.create(Employee, {
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptA),
      empCode: `E${seq++}`, fullName: 'Fixture', status: 'ACTIVE',
    });
    await em.flush();
    return emp.id;
  }

  /** A DRAFT leave document, optionally naming a related employee (HR filing on behalf). */
  async function draft(relatedEmployeeId?: string): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `LV-${seq++}`,
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptA),
      documentType: em.getReference(DocumentType, docTypeId),
      formTemplate: em.getReference(FormTemplate, templateId),
      workflow: em.getReference(Workflow, workflowId),
      createdBy: em.getReference(AppUser, userId),
      relatedEmployee: relatedEmployeeId ? em.getReference(Employee, relatedEmployeeId) : undefined,
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  async function approve(documentId: string): Promise<void> {
    const em = orm.em.fork();
    const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    doc!.status = DocStatus.APPROVED;
    doc!.approvedAt = new Date();
    await em.flush();
  }

  describe('working-day counting through the real service', () => {
    it('does not charge a public holiday inside the range', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      // Mon-Fri, with Thursday a company holiday.
      const row = await asA(() =>
        leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: FRI }),
      );
      expect(row.totalDays).toBe('4.00');
    });

    it('does not charge a Sunday the shift does not work', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      const row = await asA(() =>
        leave.create({ documentId, quotaId: annualQuotaId, fromDate: SAT, toDate: SUN }),
      );
      // Saturday is a working half-day for this shift; Sunday is not worked at all.
      expect(row.totalDays).toBe('1.00');
    });

    it('charges half for a half-day end', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      const row = await asA(() =>
        leave.create({
          documentId, quotaId: annualQuotaId,
          fromDate: MON, fromHalf: LeaveHalf.PM, toDate: WED, toHalf: LeaveHalf.AM,
        }),
      );
      // half + full + half
      expect(row.totalDays).toBe('2.00');
    });

    it('rejects a request that covers no working days', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await expect(
        asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: SUN, toDate: SUN })),
      ).rejects.toThrow(/no working days/);
    });

    it('rejects a reversed range', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await expect(
        asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: WED, toDate: MON })),
      ).rejects.toThrow(/must not precede/);
    });

    it('allows only one request per document', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: MON }));
      await expect(
        asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: TUE, toDate: TUE })),
      ).rejects.toThrow(/already carries a leave request/);
    });
  });

  describe('coverage and the daily projection', () => {
    it('unapproved leave leaves the day ABSENT', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: MON }));

      const row = await asA(() => days.recomputeDay(employeeId, MON));
      expect(row.status).toBe(AttendanceDayStatus.ABSENT);
    });

    it('approved leave turns the day into LEAVE', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: TUE }));
      await approve(documentId);

      const rows = await asA(() => days.recomputeRange(employeeId, MON, TUE));
      expect(rows.map((r) => r.status)).toEqual([
        AttendanceDayStatus.LEAVE, AttendanceDayStatus.LEAVE,
      ]);
      expect(rows[0].expectedMinutes).toBe(0);
    });

    it('leave spanning a holiday leaves the holiday a HOLIDAY', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: WED, toDate: FRI }));
      await approve(documentId);

      const rows = await asA(() => days.recomputeRange(employeeId, WED, FRI));
      expect(rows.map((r) => r.status)).toEqual([
        AttendanceDayStatus.LEAVE, AttendanceDayStatus.HOLIDAY, AttendanceDayStatus.LEAVE,
      ]);
    });

    it('half-day leave does not excuse the day, it halves the expectation', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() =>
        leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, fromHalf: LeaveHalf.AM, toDate: MON }),
      );
      await approve(documentId);

      const row = await asA(() => days.recomputeDay(employeeId, MON));
      // Morning taken, afternoon still expected and not worked -> absent for the half that counted.
      expect(row.status).toBe(AttendanceDayStatus.ABSENT);
      expect(row.expectedMinutes).toBe(240);
    });
  });

  describe('stale-leave read', () => {
    it('lists a day computed before its leave was approved, and drops it after recompute', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: MON }));

      // Computed while still a draft, then approved — the projection is now behind.
      await asA(() => days.recomputeDay(employeeId, MON));
      await new Promise((r) => setTimeout(r, 10));
      await approve(documentId);

      const stale = await asA(() => leave.staleLeaveDays());
      expect(stale.some((s) => s.employeeId === employeeId && s.date === MON)).toBe(true);

      await asA(() => days.recomputeDay(employeeId, MON));
      const after = await asA(() => leave.staleLeaveDays());
      expect(after.some((s) => s.employeeId === employeeId && s.date === MON)).toBe(false);
    });

    it('never lists unapproved leave, because nothing has been decided', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: TUE, toDate: TUE }));

      const stale = await asA(() => leave.staleLeaveDays());
      expect(stale.some((s) => s.employeeId === employeeId)).toBe(false);
    });
  });

  describe('quota policy in the leave context', () => {
    async function entitle(employeeId: string, quotaId: string, value: string) {
      const em = orm.em.fork();
      em.create(QuotaEntitlement, {
        quota: em.getReference(Quota, quotaId),
        employee: em.getReference(Employee, employeeId),
        year: 2026, entitledValue: value,
      } as never);
      await em.flush();
    }

    it('HARD_STOP annual leave rejects an over-quota reservation', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitle(employeeId, annualQuotaId, '2.00');
      await expect(
        asA(() =>
          quotaUsage.reserve({ documentId, quotaId: annualQuotaId, employeeId, qty: '3.00', year: 2026 }),
        ),
      ).rejects.toThrow(/Over quota/);
    });

    it('SOFT_WARNING sick leave records the overshoot instead of refusing', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitle(employeeId, sickQuotaId, '2.00');
      const overshoots: QuotaOvershoot[] = [];

      const usage = await asA(() =>
        quotaUsage.reserve(
          { documentId, quotaId: sickQuotaId, employeeId, qty: '3.00', year: 2026, overshoots },
        ),
      );
      expect(usage.qtyUsed).toBe('3.00');
      expect(overshoots).toHaveLength(1);
      expect(overshoots[0].quotaType).toBe('SICK_LEAVE');
      expect(Money.compare(overshoots[0].overBy, '1.00')).toBe(0);
    });

    it('splits paid and unpaid across the paid ceiling', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitle(employeeId, sickQuotaId, '90.00');
      // 28 already used, then 5 more: 2 land inside the 30-day paid ceiling, 3 outside it.
      await asA(() =>
        quotaUsage.reserve({ documentId, quotaId: sickQuotaId, employeeId, qty: '28.00', year: 2026 }),
      );
      const second = await draft(employeeId);
      await asA(() =>
        quotaUsage.reserve({ documentId: second, quotaId: sickQuotaId, employeeId, qty: '5.00', year: 2026 }),
      );

      const split = await asA(() => balance.paidSplit(sickQuotaId, { employeeId, year: 2026 }));
      expect(Money.compare(split.used, '33.00')).toBe(0);
      expect(Money.compare(split.paid, '30.00')).toBe(0);
      expect(Money.compare(split.unpaid, '3.00')).toBe(0);
    });

    it('treats a null paid limit as fully paid', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitle(employeeId, annualQuotaId, '6.00');
      await asA(() =>
        quotaUsage.reserve({ documentId, quotaId: annualQuotaId, employeeId, qty: '2.00', year: 2026 }),
      );
      const split = await asA(() => balance.paidSplit(annualQuotaId, { employeeId, year: 2026 }));
      expect(Money.compare(split.paid, '2.00')).toBe(0);
      expect(Money.compare(split.unpaid, '0')).toBe(0);
      expect(split.paidLimit).toBeNull();
    });
  });

  describe('derived quantity and the leave submit endpoint', () => {
    async function configure(quotaId: string, cfg: Partial<{ advanceNoticeDays: number; backdateLimitDays: number; attachmentRequiredOverDays: number }>) {
      const em = orm.em.fork();
      const existing = await em.findOne(LeaveType, { quota: quotaId }, FILTER_OFF);
      const row = existing ?? em.create(LeaveType, { quota: em.getReference(Quota, quotaId) });
      Object.assign(row, cfg);
      await em.persistAndFlush(row);
    }

    it('refuses a leave document through the generic submit endpoint', async () => {
      const em = orm.em.fork();
      const dt = await em.findOne(DocumentType, { id: docTypeId }, FILTER_OFF);
      dt!.derivesQuantity = true;
      await em.flush();

      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: MON }));

      await expect(asA(() => submitService.submit(documentId))).rejects.toThrow(/system-computed quantity/);
      // And it names where to go instead, rather than failing opaquely.
      await expect(asA(() => submitService.submit(documentId))).rejects.toThrow(/leave-requests/);
    });

    it('leaves an ordinary type unaffected', async () => {
      const em = orm.em.fork();
      const dt = await em.findOne(DocumentType, { id: docTypeId }, FILTER_OFF);
      dt!.derivesQuantity = false;
      await em.flush();
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      // Reaches the ordinary gates rather than the derived-quantity refusal.
      await expect(asA(() => submitService.submit(documentId))).rejects.not.toThrow(/system-computed quantity/);

      const em2 = orm.em.fork();
      const dt2 = await em2.findOne(DocumentType, { id: docTypeId }, FILTER_OFF);
      dt2!.derivesQuantity = true;
      await em2.flush();
    });

    it('re-counts at submit, so a holiday declared in between reduces the charge', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitleFor(employeeId, annualQuotaId, '10.00');
      // Mon-Wed = 3 working days at the time of the request.
      const created = await asA(() =>
        leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: WED }),
      );
      expect(created.totalDays).toBe('3.00');

      // Tuesday becomes a company holiday before the request is submitted.
      const em = orm.em.fork();
      em.create(HolidayCalendar, {
        company: em.getReference(Company, companyA), holidayDate: TUE, name: 'Declared later',
      });
      await em.flush();

      const result = await asA(() => leaveWithSpy.submit(documentId));
      expect(result.totalDays).toBe('2.00');
      // And that is exactly what was handed to the document engine.
      const call = delegated.at(-1)!;
      expect((call.dto as { quotaReservations: Array<{ qty: string }> }).quotaReservations[0].qty).toBe('2.00');
      expect(call.opts).toEqual({ quantityAlreadyDerived: true });

      const em2 = orm.em.fork();
      const stored = await em2.findOne(LeaveRequest, { id: created.id }, FILTER_OFF);
      expect(stored!.totalDays).toBe('2.00');
      // Remove the holiday so later tests see the original calendar.
      await em2.nativeDelete(HolidayCalendar, { holidayDate: TUE }, FILTER_OFF);
    });

    it('refuses a request filed with too little notice, reserving nothing', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await configure(annualQuotaId, { advanceNoticeDays: 3650, backdateLimitDays: 0 });
      const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: future, toDate: future }));

      await expect(asA(() => leave.submit(documentId))).rejects.toThrow(/at least .* day/);
      const em = orm.em.fork();
      expect(await em.find(QuotaUsage, { document: documentId }, FILTER_OFF)).toHaveLength(0);
      await configure(annualQuotaId, { advanceNoticeDays: 0 });
    });

    it('refuses backdating when the type forbids it', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await configure(annualQuotaId, { advanceNoticeDays: 0, backdateLimitDays: 0 });
      // MON is in the past relative to now.
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: MON }));
      await expect(asA(() => leave.submit(documentId))).rejects.toThrow(/already started/);
    });

    it('allows backdating within the configured window', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitleFor(employeeId, sickQuotaId, '30.00');
      await configure(sickQuotaId, { advanceNoticeDays: 0, backdateLimitDays: 3650 });
      await asA(() => leave.create({ documentId, quotaId: sickQuotaId, fromDate: MON, toDate: MON }));
      await expect(asA(() => leaveWithSpy.submit(documentId))).resolves.toMatchObject({ totalDays: '1.00' });
    });

    it('requires an attachment past the configured consecutive-day threshold', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitleFor(employeeId, sickQuotaId, '30.00');
      await configure(sickQuotaId, { advanceNoticeDays: 0, backdateLimitDays: 3650, attachmentRequiredOverDays: 3 });
      // Mon-Fri is five consecutive calendar days — past the threshold, with no attachment.
      await asA(() => leave.create({ documentId, quotaId: sickQuotaId, fromDate: MON, toDate: FRI }));
      await expect(asA(() => leave.submit(documentId))).rejects.toThrow(/supporting attachment/);
    });

    it('does not require an attachment for a short absence', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitleFor(employeeId, sickQuotaId, '30.00');
      await configure(sickQuotaId, { advanceNoticeDays: 0, backdateLimitDays: 3650, attachmentRequiredOverDays: 3 });
      await asA(() => leave.create({ documentId, quotaId: sickQuotaId, fromDate: MON, toDate: TUE }));
      await expect(asA(() => leaveWithSpy.submit(documentId))).resolves.toBeTruthy();
    });

    it('charges exactly the counted days, with no caller-supplied quantity anywhere', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitleFor(employeeId, sickQuotaId, '30.00');
      await configure(sickQuotaId, { advanceNoticeDays: 0, backdateLimitDays: 3650, attachmentRequiredOverDays: undefined as never });
      await asA(() => leave.create({ documentId, quotaId: sickQuotaId, fromDate: MON, toDate: WED }));
      await asA(() => leaveWithSpy.submit(documentId));

      const call = delegated.at(-1)!;
      const reservations = (call.dto as { quotaReservations: Array<{ quotaId: string; qty: string }> }).quotaReservations;
      expect(reservations).toHaveLength(1);
      expect(reservations[0].qty).toBe('3.00');
      expect(reservations[0].quotaId).toBe(sickQuotaId);
    });
  });

  /**
   * The rule the previous behaviour got wrong: quota was always charged to whoever created the
   * document. For HR filing on behalf of staff with no login account — the very people slice 2
   * built manual capture for — that charged the leave to HR.
   */
  describe('beneficiary resolution through the real submit path', () => {
    it('charges the related employee when the document names one', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await entitleFor(employeeId, annualQuotaId, '10.00');
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: SAT, toDate: SAT }));
      await asA(() =>
        submitService.submit(documentId, { quotaReservations: [{ quotaId: annualQuotaId, qty: '1.00', year: 2026 }] }, { quantityAlreadyDerived: true }),
      );

      const em = orm.em.fork();
      const usage = await em.findOne(QuotaUsage, { document: documentId }, { ...FILTER_OFF, populate: ['employee'] });
      expect(usage!.employee!.id).toBe(employeeId);
    });

    it('falls back to the submitter when the document names nobody', async () => {
      // The seeded user IS an employee here, so the fallback has something to resolve to.
      const em0 = orm.em.fork();
      const self = em0.create(Employee, {
        company: em0.getReference(Company, companyA),
        department: em0.getReference(Department, deptA),
        user: em0.getReference(AppUser, userId),
        empCode: `SELF${seq++}`, fullName: 'Submitter', status: 'ACTIVE',
      });
      await em0.flush();
      await entitleFor(self.id, annualQuotaId, '10.00');

      const documentId = await draft(); // no relatedEmployee
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: SAT, toDate: SAT }));
      await asA(() =>
        submitService.submit(documentId, { quotaReservations: [{ quotaId: annualQuotaId, qty: '1.00', year: 2026 }] }, { quantityAlreadyDerived: true }),
      );

      const em = orm.em.fork();
      const usage = await em.findOne(QuotaUsage, { document: documentId }, { ...FILTER_OFF, populate: ['employee'] });
      expect(usage!.employee!.id).toBe(self.id);

      // Clean up so later fallbacks do not resolve to this employee unexpectedly.
      const em2 = orm.em.fork();
      const row = await em2.findOne(Employee, { id: self.id }, FILTER_OFF);
      row!.user = undefined;
      await em2.flush();
    });

    /** The protection that already existed and must survive the change. */
    it('still ignores an employee id supplied in the request body', async () => {
      const beneficiary = await freshEmployee();
      const stranger = await freshEmployee();
      const documentId = await draft(beneficiary);
      await entitleFor(beneficiary, annualQuotaId, '10.00');
      await entitleFor(stranger, annualQuotaId, '10.00');
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: SAT, toDate: SAT }));

      await asA(() =>
        submitService.submit(
          documentId,
          { quotaReservations: [{ quotaId: annualQuotaId, employeeId: stranger, qty: '1.00', year: 2026 }] },
          { quantityAlreadyDerived: true },
        ),
      );

      const em = orm.em.fork();
      const usage = await em.findOne(QuotaUsage, { document: documentId }, { ...FILTER_OFF, populate: ['employee'] });
      expect(usage!.employee!.id).toBe(beneficiary);
      expect(usage!.employee!.id).not.toBe(stranger);
    });
  });

  /**
   * The lock still has to do its old job for HARD_STOP quotas — the policy change must not have
   * loosened contention for the quotas that still block.
   */
  it('lets exactly one of two racing reservations take the last HARD_STOP unit', async () => {
    const employeeId = await freshEmployee();
    await entitleFor(employeeId, annualQuotaId, '1.00');
    const docA = await draft(employeeId);
    const docB = await draft(employeeId);

    const results = await Promise.allSettled([
      asA(() => quotaUsage.reserve({ documentId: docA, quotaId: annualQuotaId, employeeId, qty: '1.00', year: 2026 })),
      asA(() => quotaUsage.reserve({ documentId: docB, quotaId: annualQuotaId, employeeId, qty: '1.00', year: 2026 })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const em = orm.em.fork();
    const usage = await em.find(QuotaUsage, { quota: annualQuotaId, employee: employeeId }, FILTER_OFF);
    expect(usage).toHaveLength(1);
  });

  describe('recompute on approval', () => {
    it('refreshes the covered days when the listener runs', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: TUE }));
      await asA(() => days.recomputeRange(employeeId, MON, TUE)); // computed while still a draft
      await approve(documentId);

      const listener = new LeaveApprovedListener(orm.em, days);
      await listener.onOutcome({ documentId, status: 'COMPLETED' });

      const em = orm.em.fork();
      const rows = await em.find(AttendanceDay, { employee: employeeId, shiftDate: { $gte: MON, $lte: TUE } }, FILTER_OFF);
      expect(rows.map((r) => r.status)).toEqual([AttendanceDayStatus.LEAVE, AttendanceDayStatus.LEAVE]);
    });

    it('leaves the approval standing when recomputation fails', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: WED, toDate: WED }));
      await approve(documentId);

      // A projection service that always throws: the failure must not propagate out of the
      // listener, because the approval has already committed and cannot be undone.
      const broken = { recomputeRange: async () => { throw new Error('projection exploded'); } } as never;
      const listener = new LeaveApprovedListener(orm.em, broken);
      await expect(listener.onOutcome({ documentId, status: 'COMPLETED' })).resolves.toBeUndefined();

      const em = orm.em.fork();
      const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
      expect(doc!.status).toBe(DocStatus.APPROVED);
    });

    it('ignores a document that carries no leave request', async () => {
      const documentId = await draft();
      const listener = new LeaveApprovedListener(orm.em, days);
      await expect(listener.onOutcome({ documentId, status: 'COMPLETED' })).resolves.toBeUndefined();
    });

    it('ignores an outcome that is not an approval', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft(employeeId);
      await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: FRI, toDate: FRI }));
      const listener = new LeaveApprovedListener(orm.em, days);
      await listener.onOutcome({ documentId, status: 'REJECTED' });

      const em = orm.em.fork();
      expect(await em.find(AttendanceDay, { employee: employeeId, shiftDate: FRI }, FILTER_OFF)).toHaveLength(0);
    });
  });

  it('charges the related employee, not the document creator', async () => {
    const employeeId = await freshEmployee();
    const documentId = await draft(employeeId);
    const row = await asA(() =>
      leave.create({ documentId, quotaId: annualQuotaId, fromDate: MON, toDate: MON }),
    );
    const em = orm.em.fork();
    const stored = await em.findOne(LeaveRequest, { id: row.id }, { ...FILTER_OFF, populate: ['employee'] });
    expect(stored!.employee.id).toBe(employeeId);
  });

  it('leaves no attendance_day row behind when a request is only drafted', async () => {
    const employeeId = await freshEmployee();
    const documentId = await draft(employeeId);
    await asA(() => leave.create({ documentId, quotaId: annualQuotaId, fromDate: FRI, toDate: FRI }));
    const em = orm.em.fork();
    expect(await em.find(AttendanceDay, { employee: employeeId }, FILTER_OFF)).toHaveLength(0);
  });
});
