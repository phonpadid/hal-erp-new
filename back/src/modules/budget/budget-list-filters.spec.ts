import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetService } from './budget.service';
import { Budget, BudgetNode } from './budget.entities';
import { Currency } from '../currency/currency.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';

const hasDb = await dbAvailable();

/**
 * The budget list's two filters, and the read that supplies the department options.
 *
 * The property under test in most of these is the same one `withSearch` is held to: a filter
 * NARROWS the already-scoped set and can never widen it. A filter that could reach another
 * company's rows would be a way out of invariant 1 dressed as a convenience.
 */
describe.skipIf(!hasDb)('budget list filters (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  const ids = { companyA: '', companyB: '', finance: '', marketing: '', foreign: '', empty: '' };

  const asA = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContext.run({ companyId: ids.companyA, userId: 'u', grants: [] } as never, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const scope = new CompanyScopeService(orm.em);
    budgets = new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em));

    const em = orm.em.fork();
    const lak = em.create(Currency, { code: 'LAK', name: 'Kip', decimalPlaces: 0, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: lak, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: lak, isActive: true, createdAt: new Date() });
    const finance = em.create(Department, { company: a, deptCode: 'FIN', name: 'Finance', isActive: true });
    const marketing = em.create(Department, { company: a, deptCode: 'MKT', name: 'Marketing', isActive: true });
    // In the active company, but holds no budget — must not be offered as a filter option.
    const empty = em.create(Department, { company: a, deptCode: 'EMPTY', name: 'Archive', isActive: true });
    const foreign = em.create(Department, { company: b, deptCode: 'FRN', name: 'Foreign', isActive: true });
    const fyA = em.create(FiscalYear, { company: a, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyB = em.create(FiscalYear, { company: b, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });

    const node = (fy: FiscalYear, code: string, name: string) =>
      em.create(BudgetNode, { fiscalYear: fy, code, name, nodeType: 'BUDGET', level: 1 });

    // Finance: 2 ACTIVE, 1 REJECTED. Marketing: 1 ACTIVE with a distinctive name.
    em.create(Budget, { fiscalYear: fyA, department: finance, node: node(fyA, 'FIN-1', 'Fuel'), budgetName: 'Fuel and oil', amountTotal: '100', status: 'ACTIVE' });
    em.create(Budget, { fiscalYear: fyA, department: finance, node: node(fyA, 'FIN-2', 'Stationery'), budgetName: 'Paper', amountTotal: '200', status: 'ACTIVE' });
    em.create(Budget, { fiscalYear: fyA, department: finance, node: node(fyA, 'FIN-3', 'Refused'), budgetName: 'Fuel for boats', amountTotal: '300', status: 'REJECTED' });
    em.create(Budget, { fiscalYear: fyA, department: marketing, node: node(fyA, 'MKT-1', 'Signage'), budgetName: 'Billboards', amountTotal: '400', status: 'ACTIVE' });
    // Company B, same shape — the rows every filter below must fail to reach.
    em.create(Budget, { fiscalYear: fyB, department: foreign, node: node(fyB, 'FRN-1', 'Fuel'), budgetName: 'Fuel and oil', amountTotal: '999', status: 'ACTIVE' });

    await em.flush();
    Object.assign(ids, {
      companyA: a.id, companyB: b.id,
      finance: finance.id, marketing: marketing.id, foreign: foreign.id, empty: empty.id,
    });
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  describe('the department filter', () => {
    it('narrows to that department, and total follows', async () => {
      const res = await asA(() => budgets.list({ departmentId: ids.finance }));
      expect(res.total).toBe(3);
      expect(res.items.every((b) => b.department.id === ids.finance)).toBe(true);
    });

    it('leaves the list whole when not given', async () => {
      expect((await asA(() => budgets.list({}))).total).toBe(4);
    });

    it('cannot reach another company through a department of that company', async () => {
      // Not "found in the wrong company" — not found at all, because company scope was applied
      // first. That is the property that makes this filter safe.
      const res = await asA(() => budgets.list({ departmentId: ids.foreign }));
      expect(res.total).toBe(0);
      expect(res.items).toEqual([]);
    });
  });

  describe('the status filter', () => {
    it('sets the rejected proposals aside', async () => {
      const res = await asA(() => budgets.list({ status: 'ACTIVE' }));
      expect(res.total).toBe(3);
      expect(res.items.some((b) => b.status === 'REJECTED')).toBe(false);
    });

    it('can show only what was turned down', async () => {
      const res = await asA(() => budgets.list({ status: 'REJECTED' }));
      expect(res.items.map((b) => b.budgetName)).toEqual(['Fuel for boats']);
    });

    it('shows every status when not given', async () => {
      // No default. Defaulting to ACTIVE would hide the refused proposals silently, which is a
      // decision about what a budget list means and not one to make on the reader's behalf.
      const res = await asA(() => budgets.list({}));
      expect(new Set(res.items.map((b) => b.status))).toEqual(new Set(['ACTIVE', 'REJECTED']));
    });
  });

  describe('composition', () => {
    it('applies both filters together', async () => {
      const res = await asA(() => budgets.list({ departmentId: ids.finance, status: 'ACTIVE' }));
      expect(res.total).toBe(2);
      expect(res.items.map((b) => b.budgetName).sort()).toEqual(['Fuel and oil', 'Paper']);
    });

    it('applies a filter and a search term as a conjunction', async () => {
      const res = await asA(() => budgets.list({ departmentId: ids.finance, search: 'fuel' }));
      // Both Finance fuel rows, and not Marketing's — the term alone would not have excluded it
      // had it matched, and the filter alone would not have excluded 'Paper'.
      expect(res.items.map((b) => b.budgetName).sort()).toEqual(['Fuel and oil', 'Fuel for boats']);
    });

    it('all three together narrow to one row', async () => {
      const res = await asA(() => budgets.list({ departmentId: ids.finance, status: 'ACTIVE', search: 'fuel' }));
      expect(res.items.map((b) => b.budgetName)).toEqual(['Fuel and oil']);
      expect(res.total).toBe(1);
    });

    it('a filter and a term that agree on nothing return nothing', async () => {
      const res = await asA(() => budgets.list({ departmentId: ids.marketing, search: 'fuel' }));
      expect(res.total).toBe(0);
    });
  });

  describe('paging is stable', () => {
    it('reaches every budget exactly once across its pages', async () => {
      // Found by paging the customer's 496 budgets in a browser: without an ORDER BY, Postgres
      // returns each LIMIT/OFFSET query in whatever order it likes, so 7 rows came back twice and
      // others never came back at all. A reader could page the whole list and still miss a budget.
      const seen: string[] = [];
      for (let page = 1; page <= 4; page++) {
        const res = await asA(() => budgets.list({ page, limit: 2 }));
        seen.push(...res.items.map((b) => b.id));
        if (!res.items.length) break;
      }
      expect(seen).toHaveLength(4);
      expect(new Set(seen).size).toBe(4);
    });

    it('orders by the plan code, which is what a department head reads down', async () => {
      const res = await asA(() => budgets.list({}));
      const codes = res.items.map((b) => b.node.code);
      expect(codes).toEqual([...codes].sort());
    });

    it('gives the same page the same rows twice running', async () => {
      const first = await asA(() => budgets.list({ page: 2, limit: 2 }));
      const again = await asA(() => budgets.list({ page: 2, limit: 2 }));
      expect(again.items.map((b) => b.id)).toEqual(first.items.map((b) => b.id));
    });
  });

  describe('the department options', () => {
    it('offers the departments that hold a budget', async () => {
      const options = await asA(() => budgets.listFilterDepartments());
      expect(options.map((d) => d.deptCode).sort()).toEqual(['FIN', 'MKT']);
    });

    it('does not offer a department holding no budget', async () => {
      const options = await asA(() => budgets.listFilterDepartments());
      // A reader must never be able to pick an option that yields an empty list.
      expect(options.map((d) => d.id)).not.toContain(ids.empty);
    });

    it('does not offer another company’s department', async () => {
      const options = await asA(() => budgets.listFilterDepartments());
      expect(options.map((d) => d.id)).not.toContain(ids.foreign);
    });

    it('carries identifying fields only, never a figure', async () => {
      const options = await asA(() => budgets.listFilterDepartments());
      expect(Object.keys(options[0]).sort()).toEqual(['deptCode', 'id', 'name']);
    });

    it('is ordered by name, so the control does not reshuffle between visits', async () => {
      const options = await asA(() => budgets.listFilterDepartments());
      expect(options.map((d) => d.name)).toEqual(['Finance', 'Marketing']);
    });
  });
});
