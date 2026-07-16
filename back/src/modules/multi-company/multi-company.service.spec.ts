import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { StorageService } from '../../common/storage/storage.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { AppUser, Permission, RolePermission, UserCompanyRole } from '../rbac/rbac.entities';
import { CompanyService } from './company.service';
import { DepartmentService } from './department.service';
import { FiscalYearService } from './fiscal-year.service';
import { HolidayCalendarService } from './holiday-calendar.service';
import { WorkingTimeService } from './working-time.service';
import type { MikroORM } from '@mikro-orm/postgresql';
import type { Company } from './multi-company.entities';

const hasDb = await dbAvailable();

// Run a service call as if authenticated with a given active company.
function asCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ userId: 'u1', companyId, permissions: [] }, fn);
}

let seq = 0;
const code = (p: string) => `${p}${seq++}`;

describe.skipIf(!hasDb)('multi-company services (DB-backed)', () => {
  let orm: MikroORM;
  let companies: CompanyService;
  let departments: DepartmentService;
  let fiscalYears: FiscalYearService;
  let holidays: HolidayCalendarService;
  let workingTime: WorkingTimeService;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(async () => {
    const em = orm.em.fork();
    // Currencies are not company-scoped; seed an active one for company creation.
    if (!(await em.findOne(Currency, { code: 'THB' }))) {
      em.create(Currency, { code: 'THB', name: 'Thai Baht', decimalPlaces: 2, isActive: true });
      em.create(Currency, { code: 'OLD', name: 'Retired', decimalPlaces: 2, isActive: false });
      await em.flush();
    }
    const scope = new CompanyScopeService(orm.em);
    companies = new CompanyService(orm.em, new StorageService());
    departments = new DepartmentService(scope);
    fiscalYears = new FiscalYearService(scope);
    holidays = new HolidayCalendarService(scope);
    workingTime = new WorkingTimeService(scope);
  });

  async function makeCompany(prefix = 'C'): Promise<Company> {
    return companies.create({
      code: code(prefix),
      nameTh: 'บริษัท',
      nameEn: 'Co',
      taxId: '1234567890123',
      branchCode: '00000',
      baseCurrency: 'THB',
    });
  }

  // ---- Company ----------------------------------------------------------------

  it('creates a company and rejects an inactive/unknown base currency', async () => {
    const c = await makeCompany();
    expect(c.id).toBeTruthy();
    expect(c.isActive).toBe(true);

    await expect(
      companies.create({
        code: code('BAD'),
        nameTh: 'x',
        taxId: '1234567890123',
        branchCode: '00000',
        baseCurrency: 'OLD', // inactive
      }),
    ).rejects.toThrow();
  });

  it('bootstraps the creator as ADMIN of the new company so they can switch into it', async () => {
    const em = orm.em.fork();
    const username = code('u');
    const user = em.create(AppUser, { username, email: `${username}@x.local`, status: 'ACTIVE' });
    await em.flush();

    const c = await companies.create(
      { code: code('BOOT'), nameTh: 'บ', taxId: '1234567890123', branchCode: '00000', baseCurrency: 'THB' },
      user.id,
    );

    const check = orm.em.fork();
    // The membership switchCompany resolves on — ADMIN role + a department.
    // filters off: this read is outside a RequestContext, so the company filter has no companyId
    // to bind — it throws rather than matching nothing. The `company: c.id` term is the scope.
    const membership = await check.findOne(
      UserCompanyRole,
      { user: user.id, company: c.id },
      { populate: ['role', 'department'], filters: { company: false } },
    );
    expect(membership).toBeTruthy();
    expect(membership!.role.code).toBe('ADMIN');
    expect(membership!.department.deptCode).toBe('HQ');
    // ADMIN holds every active permission, so the creator can administer immediately.
    const grants = await check.count(RolePermission, { role: membership!.role.id }, { filters: { company: false } });
    const activePerms = await check.count(Permission, { isActive: true });
    expect(grants).toBe(activePerms);
  });

  it('deactivates instead of deleting, and hides inactive from the default list', async () => {
    const c = await makeCompany();
    await companies.deactivate(c.id);

    const reread = await companies.get(c.id); // still retrievable
    expect(reread.isActive).toBe(false);

    const active = await companies.list({});
    expect(active.items.find((x) => x.id === c.id)).toBeUndefined();
    const all = await companies.list({}, true);
    expect(all.items.find((x) => x.id === c.id)).toBeTruthy();
  });

  // ---- Department tree --------------------------------------------------------

  it('rejects a cross-company parent and a reparent that creates a cycle', async () => {
    const a = await makeCompany('A');
    const b = await makeCompany('B');

    const bDept = await asCompany(b.id, () =>
      departments.create({ deptCode: code('BD'), name: 'B-Dept' }),
    );

    // Cross-company parent: B's department isn't visible in A's scope → rejected.
    await expect(
      asCompany(a.id, () =>
        departments.create({ deptCode: code('AD'), name: 'A-Dept', parentDeptId: bDept.id }),
      ),
    ).rejects.toThrow();

    // Valid same-company nesting.
    const a1 = await asCompany(a.id, () =>
      departments.create({ deptCode: code('A1'), name: 'A1' }),
    );
    const a2 = await asCompany(a.id, () =>
      departments.create({ deptCode: code('A2'), name: 'A2', parentDeptId: a1.id }),
    );
    expect(a2.parentDept?.id).toBe(a1.id);

    // Cycle: making a1's parent a2 (a2 is a1's descendant) is rejected.
    await expect(
      asCompany(a.id, () => departments.update(a1.id, { parentDeptId: a2.id })),
    ).rejects.toThrow();
  });

  it('scopes department reads to the active company', async () => {
    const a = await makeCompany('A');
    const b = await makeCompany('B');
    await asCompany(a.id, () => departments.create({ deptCode: code('AX'), name: 'AX' }));
    await asCompany(b.id, () => departments.create({ deptCode: code('BX'), name: 'BX' }));

    const aList = await asCompany(a.id, () => departments.list({}));
    expect(aList.items.length).toBeGreaterThan(0);
    expect(aList.items.every((d) => d.company.id === a.id)).toBe(true);
  });

  // ---- Fiscal year + closed-period guard --------------------------------------

  it('closes a fiscal year once and guards posting into closed/uncovered periods', async () => {
    const a = await makeCompany('FY');
    const fy = await asCompany(a.id, () =>
      fiscalYears.create({ year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' }),
    );

    // OPEN period accepts a covered date.
    await expect(
      asCompany(a.id, () => fiscalYears.assertOpenPeriod('2026-06-15')),
    ).resolves.toBeUndefined();

    // Close flips OPEN→CLOSED; a second close is rejected.
    const closed = await asCompany(a.id, () => fiscalYears.close(fy.id));
    expect(closed.status).toBe('CLOSED');
    await expect(asCompany(a.id, () => fiscalYears.close(fy.id))).rejects.toThrow();

    // Now the covered date is in a CLOSED year → rejected.
    await expect(
      asCompany(a.id, () => fiscalYears.assertOpenPeriod('2026-06-15')),
    ).rejects.toThrow();

    // A date no fiscal year covers → rejected.
    await expect(
      asCompany(a.id, () => fiscalYears.assertOpenPeriod('2030-01-01')),
    ).rejects.toThrow();
  });

  // ---- Working-time SLA -------------------------------------------------------

  it('excludes weekends and company holidays from the SLA countdown', async () => {
    const a = await makeCompany('H'); // has a Monday holiday
    const b = await makeCompany('NH'); // no holidays

    // Find the next Friday (UTC), then the Monday three days later.
    const base = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const friday = new Date(base);
    while (friday.getUTCDay() !== 5) friday.setUTCDate(friday.getUTCDate() + 1);
    const monday = new Date(friday);
    monday.setUTCDate(monday.getUTCDate() + 3);
    const mondayIso = monday.toISOString().slice(0, 10);

    await asCompany(a.id, () => holidays.create({ holidayDate: mondayIso, name: 'Holiday' }));

    const resNoHoliday = await asCompany(b.id, () => workingTime.addWorkingHours(friday, 24));
    const resHoliday = await asCompany(a.id, () => workingTime.addWorkingHours(friday, 24));

    // Both skip Sat/Sun. Without the holiday the 24th working hour lands Monday;
    // with the holiday it is pushed to Tuesday.
    expect(resNoHoliday.getUTCDay()).toBe(1); // Monday
    expect(resHoliday.getUTCDay()).toBe(2); // Tuesday
    expect(resHoliday.getTime()).toBeGreaterThan(resNoHoliday.getTime());
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[multi-company] no database reachable — skipping DB-backed spec');
}
