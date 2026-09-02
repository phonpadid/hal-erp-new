import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '../context/request-context';
import { CompanyScopeService } from '../scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../../modules/accounting/account.service';
import { BudgetService } from '../../modules/budget/budget.service';
import { BudgetBalanceService } from '../../modules/budget/budget-balance.service';
import { Budget, BudgetNode } from '../../modules/budget/budget.entities';
import { CurrencyService } from '../../modules/currency/currency.service';
import { Currency } from '../../modules/currency/currency.entities';
import { JobLevelService } from '../../modules/job-level/job-level.service';
import { JobLevel } from '../../modules/job-level/job-level.entities';
import { QuotaService } from '../../modules/quota/quota.service';
import { QuotaBalanceService } from '../../modules/quota/quota-balance.service';
import { Quota } from '../../modules/quota/quota.entities';
import { WarehouseService } from '../../modules/inventory/warehouse.service';
import { Warehouse } from '../../modules/inventory/inventory.entities';
import { Account } from '../../modules/accounting/accounting.entities';
import { Company, Department, FiscalYear } from '../../modules/multi-company/multi-company.entities';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The search term, at the endpoints that accept one.
 *
 * `with-search.spec.ts` proves the helper narrows rather than replaces. These prove each list read
 * actually calls it, over the columns a person reads on the row, and — the property that matters —
 * that a term still cannot reach another company's data. Two scoping styles are in play and both
 * are covered: an explicit `where` clause (accounts, budgets) and MikroORM's `company` filter with
 * no clause of its own (warehouses, job levels, quota). The second is the one a `$and` wrapper
 * could plausibly have broken.
 */
describe.skipIf(!hasDb)('list search across endpoints (DB-backed)', () => {
  let orm: MikroORM;
  let accounts: AccountService;
  let budgets: BudgetService;
  let currencies: CurrencyService;
  let jobLevels: JobLevelService;
  let quotas: QuotaService;
  let warehouses: WarehouseService;
  const ids = { companyA: '', companyB: '' };

  /** Run a read as company A, the way a request context would. */
  const asA = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ companyId: ids.companyA, userId: 'u', permissions: {} } as never, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const scope = new CompanyScopeService(orm.em);
    accounts = new AccountService(orm.em, scope);
    budgets = new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em));
    currencies = new CurrencyService(orm.em);
    jobLevels = new JobLevelService(orm.em, scope);
    quotas = new QuotaService(scope, new QuotaBalanceService(orm.em));
    warehouses = new WarehouseService(scope);

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Thai baht', symbol: '฿', decimalPlaces: 2, isActive: true });
    em.create(Currency, { code: 'LAK', name: 'Lao kip', symbol: '₭', decimalPlaces: 0, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const deptA = em.create(Department, { company: a, deptCode: 'PROC', name: 'Procurement', isActive: true });
    const deptB = em.create(Department, { company: b, deptCode: 'PROC', name: 'Procurement', isActive: true });
    const fyA = em.create(FiscalYear, { company: a, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: b, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });

    // Twenty-five accounts in company A, so the one being searched for falls on a later page.
    for (let i = 0; i < 25; i++) {
      em.create(Account, {
        company: a, code: `10${String(i).padStart(2, '0')}`, name: `Filler account ${i}`,
        accountType: 'ASSET', isPostable: true, isActive: true,
      });
    }
    em.create(Account, { company: a, code: '5210', name: 'Utilities expense', accountType: 'EXPENSE', isPostable: true, isActive: true });
    // The same text in company B — the row every search below must not reach.
    em.create(Account, { company: b, code: '5210', name: 'Utilities expense', accountType: 'EXPENSE', isPostable: true, isActive: true });

    const nodeA = em.create(BudgetNode, { fiscalYear: fyA, code: 'OPEX-UTIL', name: 'Utilities', nodeType: 'BUDGET', level: 1 });
    const nodeA2 = em.create(BudgetNode, { fiscalYear: fyA, code: 'CAPEX-VEH', name: 'Vehicles', nodeType: 'BUDGET', level: 1 });
    const nodeB = em.create(BudgetNode, { fiscalYear: fyB, code: 'OPEX-UTIL', name: 'Utilities', nodeType: 'BUDGET', level: 1 });
    em.create(Budget, { fiscalYear: fyA, department: deptA, node: nodeA, budgetName: 'Electricity and water', amountTotal: '1000.00', status: 'ACTIVE' });
    em.create(Budget, { fiscalYear: fyA, department: deptA, node: nodeA2, budgetName: 'Pickup replacement', amountTotal: '2000.00', status: 'ACTIVE' });
    em.create(Budget, { fiscalYear: fyB, department: deptB, node: nodeB, budgetName: 'Electricity and water', amountTotal: '3000.00', status: 'ACTIVE' });

    em.create(JobLevel, { company: a, code: 'MGR', name: 'Manager', rank: 1, isActive: true });
    em.create(JobLevel, { company: a, code: 'STF', name: 'Staff', rank: 2, isActive: true });
    em.create(JobLevel, { company: b, code: 'MGR', name: 'Manager', rank: 1, isActive: true });

    em.create(Quota, { company: a, department: deptA, quotaType: 'FUEL', unit: 'litre', limitValue: '500.00', isActive: true });
    em.create(Quota, { company: a, department: deptA, quotaType: 'PHONE', unit: 'minute', limitValue: '600.00', isActive: true });
    em.create(Quota, { company: b, department: deptB, quotaType: 'FUEL', unit: 'litre', limitValue: '700.00', isActive: true });

    em.create(Warehouse, { company: a, code: 'WH-CENTRAL', name: 'Central store', isActive: true });
    em.create(Warehouse, { company: a, code: 'WH-COLD', name: 'Cold store', isActive: true });
    em.create(Warehouse, { company: b, code: 'WH-CENTRAL', name: 'Central store', isActive: true });

    await em.flush();
    Object.assign(ids, { companyA: a.id, companyB: b.id });
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  describe('chart of accounts', () => {
    it('finds a code that falls on a later page, from page 1', async () => {
      const unsearched = await asA(() => accounts.list({ page: 1, limit: 20 }, true));
      // Without the term the row is not on the first page at all.
      expect(unsearched.items.map((r) => r.code)).not.toContain('5210');

      const found = await asA(() => accounts.list({ page: 1, limit: 20, search: '5210' }, true));
      expect(found.items.map((r) => r.code)).toEqual(['5210']);
      // `total` counts the matches, not the whole chart — the pager must agree with the list.
      expect(found.total).toBe(1);
    });

    it('matches on the name, case-insensitively', async () => {
      const res = await asA(() => accounts.list({ search: 'UTILITIES' }, true));
      expect(res.items.map((r) => r.name)).toEqual(['Utilities expense']);
    });

    it('empties the list for a term nothing matches', async () => {
      const res = await asA(() => accounts.list({ search: 'zzz-no-such-account' }, true));
      expect(res.items).toHaveLength(0);
      expect(res.total).toBe(0);
    });

    it('cannot reach the identical row in the other company', async () => {
      const res = await asA(() => accounts.list({ search: 'utilities' }, true));
      expect(res.total).toBe(1);
      // Both companies really do hold one; the search saw exactly its own.
      expect(await orm.em.fork().count(Account, { code: '5210' }, FILTER_OFF)).toBe(2);
    });
  });

  describe('budgets', () => {
    it('searches the plan code on the node, not only the budget’s own name', async () => {
      const res = await asA(() => budgets.list({ search: 'OPEX' }));
      expect(res.items.map((r) => r.budgetName)).toEqual(['Electricity and water']);
      expect(res.total).toBe(1);
    });

    it('searches the budget name', async () => {
      const res = await asA(() => budgets.list({ search: 'pickup' }));
      expect(res.items.map((r) => r.budgetName)).toEqual(['Pickup replacement']);
    });

    it('cannot reach the other company’s identically named budget', async () => {
      const res = await asA(() => budgets.list({ search: 'electricity' }));
      expect(res.total).toBe(1);
      expect(await orm.em.fork().count(Budget, { budgetName: 'Electricity and water' }, FILTER_OFF)).toBe(2);
    });

    it('leaves the scoped list whole when no term is given', async () => {
      const res = await asA(() => budgets.list({}));
      expect(res.total).toBe(2);
    });
  });

  describe('currencies (global, not company-scoped)', () => {
    it('narrows by code and by name', async () => {
      expect((await currencies.list({ search: 'LAK' }, true)).items.map((c) => c.code)).toEqual(['LAK']);
      expect((await currencies.list({ search: 'baht' }, true)).items.map((c) => c.code)).toEqual(['THB']);
      expect((await currencies.list({ search: 'zzz' }, true)).total).toBe(0);
    });
  });

  describe('reads scoped by the company filter rather than a where clause', () => {
    it('job levels: narrows, and stays inside the company', async () => {
      const res = await asA(() => jobLevels.list({ search: 'manager' }, true));
      expect(res.items.map((j) => j.code)).toEqual(['MGR']);
      expect(res.total).toBe(1);
      expect(await orm.em.fork().count(JobLevel, { code: 'MGR' }, FILTER_OFF)).toBe(2);
    });

    it('quota: narrows on type and on unit, and stays inside the company', async () => {
      expect((await asA(() => quotas.list({ search: 'FUEL' }, true))).total).toBe(1);
      expect((await asA(() => quotas.list({ search: 'minute' }, true))).items.map((q) => q.quotaType)).toEqual(['PHONE']);
      expect(await orm.em.fork().count(Quota, { quotaType: 'FUEL' }, FILTER_OFF)).toBe(2);
    });

    it('warehouses: narrows, and stays inside the company', async () => {
      const res = await asA(() => warehouses.list({ search: 'central' }, true));
      expect(res.items.map((w) => w.code)).toEqual(['WH-CENTRAL']);
      expect(res.total).toBe(1);
      expect(await orm.em.fork().count(Warehouse, { code: 'WH-CENTRAL' }, FILTER_OFF)).toBe(2);
    });

    it('an absent term leaves each scoped list whole', async () => {
      expect((await asA(() => jobLevels.list({}, true))).total).toBe(2);
      expect((await asA(() => quotas.list({}, true))).total).toBe(2);
      expect((await asA(() => warehouses.list({}, true))).total).toBe(2);
    });
  });
});
