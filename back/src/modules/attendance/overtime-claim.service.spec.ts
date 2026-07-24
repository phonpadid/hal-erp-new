import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AttendanceDayStatus, DocCategory, DocStatus } from '../../common/enums';
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
import { AppUser, Employee } from '../rbac/rbac.entities';
import { AttendanceDay, OvertimeClaim } from './attendance.entities';
import { OvertimeClaimService } from './overtime-claim.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

// 2026-03-02 Mon … 2026-03-08 Sun; 2026-03-09 is the next Monday.
const MON = '2026-03-02';
const TUE = '2026-03-03';
const WED = '2026-03-04';
const SUN = '2026-03-08';
const NEXT_MON = '2026-03-09';

describe.skipIf(!hasDb)('OvertimeClaimService (DB-backed)', () => {
  let orm: MikroORM;
  let claims: OvertimeClaimService;
  let submitService: DocumentSubmitService;
  let companyA = '';
  let deptA = '';
  let docTypeId = '';
  let templateId = '';
  let workflowId = '';
  let userId = '';
  let seq = 0;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    submitService = new DocumentSubmitService(
      orm.em,
      new ExchangeRateService(orm.em),
      new FiscalYearService(scope),
      null as never,
      null as never,
      null as never,
      new QuotaUsageService(orm.em, new QuotaBalanceService(orm.em)),
    );
    claims = new OvertimeClaimService(orm.em, scope, submitService);

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, {
      code: 'A', nameTh: 'A', branchCode: '00000', baseCurrency: thb, isActive: true,
      timezone: 'Asia/Bangkok', overtimeWeeklyLimitMinutes: 2160, createdAt: new Date(),
    });
    const d = em.create(Department, { company: a, deptCode: 'DA', name: 'DA', isActive: true });
    const u = em.create(AppUser, { username: 'ot-user', email: 'ot@x.local', status: 'ACTIVE' });
    const dt = em.create(DocumentType, {
      company: a, code: 'OT', name: 'Overtime', category: DocCategory.HR,
      requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
      requiresPayee: false, requiresWarehouse: false, derivesQuantity: true, isActive: true,
    } as never);
    const tmpl = em.create(FormTemplate, { documentType: dt, version: 1, isActive: true } as never);
    const wf = em.create(Workflow, { company: a, name: 'OT WF', isActive: true } as never);
    em.create(FiscalYear, { company: a, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    await em.flush();
    companyA = a.id; deptA = d.id; userId = u.id;
    docTypeId = dt.id; templateId = tmpl.id; workflowId = wf.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ companyId: companyA, userId, grants: [] }, fn);

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

  /** A computed day carrying overtime, written directly so the fixture controls the minutes. */
  async function dayWith(
    employeeId: string,
    shiftDate: string,
    m: { normal?: number; holidayWork?: number; otHoliday?: number },
  ) {
    const em = orm.em.fork();
    em.create(AttendanceDay, {
      company: em.getReference(Company, companyA),
      employee: em.getReference(Employee, employeeId),
      shiftDate,
      status: AttendanceDayStatus.PRESENT,
      otNormalMinutes: m.normal ?? 0,
      holidayWorkMinutes: m.holidayWork ?? 0,
      otHolidayMinutes: m.otHoliday ?? 0,
      computedAt: new Date(),
    });
    await em.flush();
  }

  async function draft(): Promise<string> {
    const em = orm.em.fork();
    const doc = em.create(Document, {
      docNo: `OT-${seq++}`,
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptA),
      documentType: em.getReference(DocumentType, docTypeId),
      formTemplate: em.getReference(FormTemplate, templateId),
      workflow: em.getReference(Workflow, workflowId),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.DRAFT,
      exchangeRate: '1',
      createdAt: new Date(),
    } as never);
    await em.flush();
    return doc.id;
  }

  async function setStatus(documentId: string, status: DocStatus) {
    const em = orm.em.fork();
    const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    doc!.status = status;
    await em.flush();
  }

  describe('summation from the projection', () => {
    it('keeps the three kinds apart and never totals them away', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      await dayWith(employeeId, TUE, { holidayWork: 480, otHoliday: 120 });
      const documentId = await draft();

      const claim = await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: TUE }));
      expect(claim.otNormalMinutes).toBe(60);
      expect(claim.holidayWorkMinutes).toBe(480);
      expect(claim.otHolidayMinutes).toBe(120);
      expect(claim.totalMinutes).toBe(660);
    });

    it('takes its hours from the projection, not from the caller', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 90 });
      const documentId = await draft();
      const claim = await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));
      // The DTO carries no hours at all — there is nowhere for a claimant to state one.
      expect(claim.otNormalMinutes).toBe(90);
    });

    it('rejects a range with no recorded overtime', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, {});
      const documentId = await draft();
      await expect(
        asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON })),
      ).rejects.toThrow(/nothing to certify/);
    });

    it('rejects a reversed range', async () => {
      const employeeId = await freshEmployee();
      const documentId = await draft();
      await expect(
        asA(() => claims.create({ documentId, employeeId, fromDate: WED, toDate: MON })),
      ).rejects.toThrow(/must not precede/);
    });

    it('allows only one claim per document', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));
      await expect(
        asA(() => claims.create({ documentId, employeeId, fromDate: TUE, toDate: TUE })),
      ).rejects.toThrow(/already carries an overtime claim/);
    });
  });

  /** The design's central constraint: the projection must stay rebuildable. */
  describe('claim status is derived, never written onto a day', () => {
    it('adds no claim reference to attendance_day', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));

      const em = orm.em.fork();
      const day = await em.findOne(AttendanceDay, { employee: employeeId, shiftDate: MON }, FILTER_OFF);
      // No column exists to carry it, and nothing about the day changed.
      expect(Object.keys(day!)).not.toContain('otClaim');
      expect(day!.otNormalMinutes).toBe(60);
    });

    it('answers "is this day claimed" by relation', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));

      const claimed = await asA(() => claims.claimedDates(employeeId, MON, WED));
      expect(claimed.has(MON)).toBe(true);
      expect(claimed.has(TUE)).toBe(false);
    });
  });

  describe('a day may be claimed once', () => {
    it('blocks a second claim over the same day', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const first = await draft();
      await asA(() => claims.create({ documentId: first, employeeId, fromDate: MON, toDate: MON }));

      const second = await draft();
      await expect(
        asA(() => claims.create({ documentId: second, employeeId, fromDate: MON, toDate: MON })),
      ).rejects.toThrow(/already been claimed/);
    });

    it('blocks while the first claim is still awaiting approval', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const first = await draft();
      await asA(() => claims.create({ documentId: first, employeeId, fromDate: MON, toDate: MON }));
      await setStatus(first, DocStatus.IN_APPROVAL);

      const second = await draft();
      await expect(
        asA(() => claims.create({ documentId: second, employeeId, fromDate: MON, toDate: MON })),
      ).rejects.toThrow(/already been claimed/);
    });

    it('releases the days when the first claim is rejected', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const first = await draft();
      await asA(() => claims.create({ documentId: first, employeeId, fromDate: MON, toDate: MON }));
      await setStatus(first, DocStatus.REJECTED);

      const second = await draft();
      await expect(
        asA(() => claims.create({ documentId: second, employeeId, fromDate: MON, toDate: MON })),
      ).resolves.toBeTruthy();
    });

    it('allows adjacent ranges that do not overlap', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      await dayWith(employeeId, TUE, { normal: 60 });
      const first = await draft();
      await asA(() => claims.create({ documentId: first, employeeId, fromDate: MON, toDate: MON }));
      const second = await draft();
      await expect(
        asA(() => claims.create({ documentId: second, employeeId, fromDate: TUE, toDate: TUE })),
      ).resolves.toBeTruthy();
    });

    /**
     * The overlap rule lives in the service, so it is only as good as its lock. Two concurrent
     * claims over the same day must not both find a clear range — this fails without the
     * FOR UPDATE on the employee.
     */
    it('stores at most one of two concurrent claims over the same day', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const docA = await draft();
      const docB = await draft();

      const results = await Promise.allSettled([
        asA(() => claims.create({ documentId: docA, employeeId, fromDate: MON, toDate: MON })),
        asA(() => claims.create({ documentId: docB, employeeId, fromDate: MON, toDate: MON })),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const em = orm.em.fork();
      expect(await em.find(OvertimeClaim, { employee: employeeId }, FILTER_OFF)).toHaveLength(1);
    });
  });

  describe('statutory weekly ceiling', () => {
    it('accepts a week below the ceiling', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 120 });
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));
      await expect(asA(() => claims.submit(documentId))).resolves.toBeTruthy();
    });

    it('refuses a week above the ceiling and reserves nothing', async () => {
      const employeeId = await freshEmployee();
      // 2160 is the limit; 2400 across the week is over it.
      await dayWith(employeeId, MON, { normal: 1200 });
      await dayWith(employeeId, TUE, { normal: 1200 });
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: TUE }));
      await expect(asA(() => claims.submit(documentId))).rejects.toThrow(/above the limit/);

      const em = orm.em.fork();
      const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
      expect(doc!.status).toBe(DocStatus.DRAFT);
    });

    /** Leaving hours unclaimed must not lift the cap — it is about hours worked. */
    it('counts recorded hours, not claimed ones', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });    // the modest day being claimed
      await dayWith(employeeId, TUE, { normal: 2400 });  // recorded but never claimed
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));
      await expect(asA(() => claims.submit(documentId))).rejects.toThrow(/above the limit/);
    });

    it('names the week and the recorded total in the refusal', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 3000 });
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));
      await expect(asA(() => claims.submit(documentId))).rejects.toThrow(/2026-03-02 to 2026-03-08/);
      await expect(asA(() => claims.submit(documentId))).rejects.toThrow(/3000 minutes/);
    });

    it('checks both weeks when a claim crosses a boundary', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, SUN, { normal: 60 });        // week of 03-02
      await dayWith(employeeId, NEXT_MON, { normal: 3000 }); // week of 03-09, over the limit
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: SUN, toDate: NEXT_MON }));
      // The first week is fine; the second is not, and the second must still be checked.
      await expect(asA(() => claims.submit(documentId))).rejects.toThrow(/2026-03-09 to 2026-03-15/);
    });
  });

  describe('submit', () => {
    it('is refused by the generic endpoint', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));
      await expect(asA(() => submitService.submit(documentId))).rejects.toThrow(/system-computed quantity/);
    });

    it('succeeds for a company with no OT quota, because the ceiling is what binds', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const documentId = await draft();
      await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));

      const result = await asA(() => claims.submit(documentId));
      expect(result.hours.totalMinutes).toBe(60);
      const em = orm.em.fork();
      const doc = await em.findOne(Document, { id: documentId }, FILTER_OFF);
      expect(doc!.status).toBe(DocStatus.SUBMITTED);
    });

    it('re-sums at submit, so a recomputed day changes the claim', async () => {
      const employeeId = await freshEmployee();
      await dayWith(employeeId, MON, { normal: 60 });
      const documentId = await draft();
      const created = await asA(() => claims.create({ documentId, employeeId, fromDate: MON, toDate: MON }));
      expect(created.otNormalMinutes).toBe(60);

      // The projection is recomputed and the day now carries more overtime.
      const em = orm.em.fork();
      const day = await em.findOne(AttendanceDay, { employee: employeeId, shiftDate: MON }, FILTER_OFF);
      day!.otNormalMinutes = 120;
      await em.flush();

      const result = await asA(() => claims.submit(documentId));
      expect(result.hours.otNormalMinutes).toBe(120);
    });
  });
});
