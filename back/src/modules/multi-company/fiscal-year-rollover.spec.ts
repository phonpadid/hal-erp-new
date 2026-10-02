import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ControlPolicy } from '../../common/enums';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Budget } from '../budget/budget.entities';
import { FiscalYearReadinessScheduler, compose } from '../notification/fiscal-year-readiness.scheduler';
import { Notification } from '../notification/notification.entities';
import { NotificationService } from '../notification/notification.service';
import { TemplateService } from '../notification/template.service';
import { Quota, QuotaEntitlement } from '../quota/quota.entities';
import { AppUser, Employee, Permission, Role, RolePermission, UserCompanyRole } from '../rbac/rbac.entities';
import { FiscalYearReadinessService } from './fiscal-year-readiness.service';
import { FiscalYearService } from './fiscal-year.service';
import { Company, Department, FiscalYear } from './multi-company.entities';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/** An instant that is `localDay` 10:00 in Vientiane (UTC+7). */
const at = (localDay: string) => new Date(`${localDay}T03:00:00Z`);

/**
 * Nothing prepares a fiscal year on its own. These are the pieces that make the gap visible and
 * keep it from turning into a wrong number or a wrong year: the company's own "today", the refusal
 * of overlapping years, the "may a budget document start today" question, the readiness read, and
 * the daily notice to the people who prepare a year.
 */
describe.skipIf(!hasDb)('fiscal-year rollover guard (DB-backed)', () => {
  let orm: MikroORM;
  let years: FiscalYearService;
  let readiness: FiscalYearReadinessService;
  let scheduler: FiscalYearReadinessScheduler;
  const ids = { company: '', other: '', dept: '', fy2026: '', admin: '', budgetOfficer: '', requester: '', quota: '' };

  const asCtx = <T>(fn: () => Promise<T>, companyId = ids.company) =>
    RequestContext.run({ companyId, grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const company = em.create(Company, { code: 'HAL', nameTh: 'HAL', taxId: '1', branchCode: '00000', timezone: 'Asia/Vientiane', isActive: true });
    const other = em.create(Company, { code: 'OTH', nameTh: 'OTH', taxId: '2', branchCode: '00000', timezone: 'Asia/Vientiane', isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const fy2026 = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    em.create(FiscalYear, { company: other, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const budget = budgetAt(em, { fiscalYear: fy2026, department: dept, code: '6.101', glAccount: '612.06', amountTotal: '1000', controlPolicy: ControlPolicy.HARD_STOP, status: 'ACTIVE' });
    attachCoverage(em, company, budget);

    // Three people: one per readiness code would do, but a FISCAL_YEAR_MANAGE admin and a
    // BUDGET_MANAGE officer are the two real jobs; the requester holds neither and must hear nothing.
    const fyManage = em.create(Permission, { code: 'FISCAL_YEAR_MANAGE', name: 'fy', module: 'org' });
    const budgetManage = em.create(Permission, { code: 'BUDGET_MANAGE', name: 'bm', module: 'budget' });
    const docCreate = em.create(Permission, { code: 'DOC_CREATE', name: 'dc', module: 'doc' });
    const adminRole = em.create(Role, { company, code: 'ADMIN', name: 'Admin' });
    const officerRole = em.create(Role, { company, code: 'BUDGET', name: 'Budget' });
    const requesterRole = em.create(Role, { company, code: 'REQ', name: 'Requester' });
    em.create(RolePermission, { role: adminRole, permission: fyManage });
    em.create(RolePermission, { role: officerRole, permission: budgetManage });
    em.create(RolePermission, { role: requesterRole, permission: docCreate });
    const admin = em.create(AppUser, { username: 'admin', email: 'a@x', status: 'ACTIVE' });
    const officer = em.create(AppUser, { username: 'officer', email: 'o@x', status: 'ACTIVE' });
    const requester = em.create(AppUser, { username: 'req', email: 'r@x', status: 'ACTIVE' });
    em.create(UserCompanyRole, { user: admin, company, department: dept, role: adminRole, isDefault: true });
    em.create(UserCompanyRole, { user: officer, company, department: dept, role: officerRole, isDefault: true });
    em.create(UserCompanyRole, { user: requester, company, department: dept, role: requesterRole, isDefault: true });

    // One person entitled to leave in 2026 — the pair 2027 must not forget.
    const employee = em.create(Employee, { company, department: dept, empCode: 'E1', fullName: 'Employee One' });
    const quota = em.create(Quota, { company, quotaType: 'ANNUAL_LEAVE', unit: 'DAY', limitValue: '12' });
    em.create(QuotaEntitlement, { quota, employee, year: 2026, entitledValue: '12' });
    await em.flush();

    Object.assign(ids, {
      company: company.id, other: other.id, dept: dept.id, fy2026: fy2026.id,
      admin: admin.id, budgetOfficer: officer.id, requester: requester.id, quota: quota.id,
    });

    const scope = new CompanyScopeService(orm.em as EntityManager);
    years = new FiscalYearService(scope);
    readiness = new FiscalYearReadinessService(orm.em as EntityManager, years);
    const notifications = new NotificationService(orm.em as EntityManager, new TemplateService(orm.em as EntityManager), []);
    scheduler = new FiscalYearReadinessScheduler(orm.em as EntityManager, readiness, notifications);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe("the company's own today", () => {
    it('is already the new year at 03:00 local on January 1, while UTC is still December 31', async () => {
      // 2026-12-31T20:00Z is 2027-01-01 03:00 in Vientiane.
      expect(await years.todayFor(ids.company, new Date('2026-12-31T20:00:00Z'))).toBe('2027-01-01');
    });
  });

  describe('fiscal years do not overlap', () => {
    it('refuses a year starting inside another', async () => {
      await expect(
        asCtx(() => years.create({ year: 2027, startDate: '2026-12-01', endDate: '2027-11-30' })),
      ).rejects.toMatchObject({ messageKey: 'fiscalYear.overlap', params: { year: 2026 } });
      expect(await orm.em.fork().count(FiscalYear, { company: ids.company }, FILTER_OFF)).toBe(1);
    });

    it('refuses an end that does not follow the start', async () => {
      await expect(
        asCtx(() => years.create({ year: 2030, startDate: '2030-12-31', endDate: '2030-01-01' })),
      ).rejects.toMatchObject({ messageKey: 'fiscalYear.badRange' });
    });

    it("ignores another company's years", async () => {
      // OTH has 2026 too; HAL's own 2026 is what clashes above, not OTH's.
      const em = orm.em.fork();
      expect(await em.count(FiscalYear, { company: ids.other }, FILTER_OFF)).toBe(1);
    });
  });

  describe('may a budget document start on a given day', () => {
    it('may, inside an open year holding an active budget', async () => {
      expect(await asCtx(() => years.budgetBlockOn('2026-06-01'))).toBeNull();
    });

    it('may not when no year covers the day, and names the year', async () => {
      expect(await asCtx(() => years.budgetBlockOn('2027-01-02'))).toEqual({ key: 'fiscalYear.noOpenYear', year: 2027 });
      await expect(asCtx(() => years.assertBudgetedOpenYear('2027-01-02'))).rejects.toMatchObject({
        messageKey: 'fiscalYear.noOpenYear',
        params: { year: 2027 },
      });
    });
  });

  describe('readiness and the daily notice', () => {
    // The sweep stamps each notice with the real clock and dedupes against it, so the clock is
    // moved with the day under test — only `Date`, so the database driver's timers are untouched.
    const sweepAt = (instant: Date) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(instant);
      return scheduler.run(instant);
    };
    afterEach(() => vi.useRealTimers());

    it('reports nothing prepared for 2027 on 2026-12-05', async () => {
      const r = await readiness.read(ids.company, at('2026-12-05'));
      expect(r.daysLeft).toBe(26);
      expect(r.inWindow).toBe(true);
      expect(r.target).toMatchObject({ year: 2027, exists: false, activeBudgets: 0, missingEntitlements: 1 });
      expect(r.ready).toBe(false);
      expect(r.blockedNow).toBeNull();
    });

    it('sends nothing before the thirty-day window', async () => {
      expect(await sweepAt(at('2026-11-30'))).toBe(0);
    });

    it('notifies each holder once on the first day of the window, and not the requester', async () => {
      expect(await sweepAt(at('2026-12-01'))).toBe(2);
      // A later sweep the same local day sends nothing new.
      expect(await sweepAt(new Date('2026-12-01T10:00:00Z'))).toBe(0);
      const rows = await orm.em.fork().find(Notification, { company: ids.company }, FILTER_OFF);
      expect(rows.map((n) => n.user.id).sort()).toEqual([ids.admin, ids.budgetOfficer].sort());
      expect(rows.some((n) => n.user.id === ids.requester)).toBe(false);
      expect(rows[0].message).toContain('2027');
    });

    it('notifies again the next day', async () => {
      expect(await sweepAt(at('2026-12-02'))).toBe(2);
    });

    it('a plan still in approval does not count as budgeted', async () => {
      const em = orm.em.fork();
      const fy = em.create(FiscalYear, { company: em.getReference(Company, ids.company), year: 2027, startDate: '2027-01-01', endDate: '2027-12-31', status: 'OPEN' });
      budgetAt(em, { fiscalYear: fy, department: em.getReference(Department, ids.dept), code: '6.101', glAccount: '612.06', amountTotal: '1000', controlPolicy: ControlPolicy.HARD_STOP, status: 'DRAFT', withoutAccount: true });
      await em.flush();
      const r = await readiness.read(ids.company, at('2026-12-10'));
      expect(r.target).toMatchObject({ exists: true, activeBudgets: 0 });
      expect(r.ready).toBe(false);
    });

    it('stops warning once 2027 is budgeted and entitled', async () => {
      const em = orm.em.fork();
      const fy = await em.findOneOrFail(FiscalYear, { company: ids.company, year: 2027 }, FILTER_OFF);
      const draft = await em.findOneOrFail(Budget, { fiscalYear: fy.id }, FILTER_OFF);
      draft.status = 'ACTIVE';
      const e = await em.findOneOrFail(QuotaEntitlement, { quota: ids.quota, year: 2026 }, FILTER_OFF);
      em.create(QuotaEntitlement, { quota: e.quota, employee: e.employee, year: 2027, entitledValue: '12' });
      await em.flush();

      const r = await readiness.read(ids.company, at('2026-12-15'));
      expect(r.ready).toBe(true);
      expect(await sweepAt(at('2026-12-15'))).toBe(0);
    });

    it('tells admins budget documents are blocked once the year turned unprepared', () => {
      const { message } = compose({
        today: '2027-01-02', current: null, daysLeft: null, ready: false, inWindow: false,
        blockedNow: { key: 'fiscalYear.noOpenYear', year: 2027 },
        target: { year: 2027, exists: false, status: null, activeBudgets: 0, missingEntitlements: 0, hasBudgetRate: false },
      });
      expect(message).toContain('ສ້າງເອກະສານທີ່ໃຊ້ງົບປະມານບໍ່ໄດ້');
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[fiscal-year-rollover] no database reachable — skipping DB-backed spec');
}
