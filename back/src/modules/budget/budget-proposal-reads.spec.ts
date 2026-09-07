import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetService } from './budget.service';
import { Budget, BudgetNode } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * The two lists the budget proposal form needs, read through budget-scoped endpoints instead of the
 * organisation directory. See `budget-proposal-reads-gate` for why they exist at all; these pin
 * what they return.
 */
describe.skipIf(!hasDb)('the reads a budget proposal needs (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  const ids = {
    company: '', other: '',
    budgeted: '', unbudgeted: '', inactive: '', otherDept: '',
    fyOpen: '', fyClosed: '', fyOther: '',
  };

  const asCompany = <T>(fn: () => Promise<T>, companyId = ids.company): Promise<T> =>
    RequestContext.run({ companyId, departmentId: ids.budgeted, userId: 'u', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const other = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });

    const budgeted = em.create(Department, { company, deptCode: 'ADM', name: 'Administration', isActive: true });
    // The case the FILTER read deliberately excludes and this one must include: a department with
    // no budget at all. Its first budget is what the proposal form exists to propose.
    const unbudgeted = em.create(Department, { company, deptCode: 'NEW', name: 'Newly formed', isActive: true });
    const inactive = em.create(Department, { company, deptCode: 'OLD', name: 'Wound up', isActive: false });
    const otherDept = em.create(Department, { company: other, deptCode: 'BD', name: 'B dept', isActive: true });

    const fyOpen = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyClosed = em.create(FiscalYear, { company, year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', status: 'CLOSED' });
    const fyOther = em.create(FiscalYear, { company: other, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });

    // One budget, so `budgeted` is a department the filter read would return and `unbudgeted` is not.
    const node = em.create(BudgetNode, { fiscalYear: fyOpen, code: '1.101', name: 'Office supplies' });
    em.create(Budget, {
      fiscalYear: fyOpen, department: budgeted, node,
      budgetName: 'Office supplies', amountTotal: '350000000', status: 'ACTIVE',
    });

    await em.persistAndFlush(company);
    Object.assign(ids, {
      company: company.id, other: other.id,
      budgeted: budgeted.id, unbudgeted: unbudgeted.id, inactive: inactive.id, otherDept: otherDept.id,
      fyOpen: fyOpen.id, fyClosed: fyClosed.id, fyOther: fyOther.id,
    });

    budgets = new BudgetService(
      orm.em,
      new AccountService(orm.em, new CompanyScopeService(orm.em)),
      new BudgetBalanceService(orm.em),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('the departments a budget may be proposed for', () => {
    it('includes a department that holds no budget yet', async () => {
      // The whole reason this is a second read rather than a reuse of `listFilterDepartments`:
      // sourcing the picker there would make an unbudgeted department unbudgetable through the UI.
      const rows = await asCompany(() => budgets.listSelectableDepartments());
      expect(rows.map((d) => d.deptCode)).toContain('NEW');
    });

    it('is broader here than in the filter, which offers only budgeted departments', async () => {
      const proposable = await asCompany(() => budgets.listSelectableDepartments());
      const filterable = await asCompany(() => budgets.listFilterDepartments());
      // Asserted as a relationship, not as two literal lists: the two reads differ ON PURPOSE and
      // a later "simplification" that collapses them would break exactly this.
      expect(filterable.map((d) => d.deptCode)).toEqual(['ADM']);
      expect(proposable.map((d) => d.deptCode)).toEqual(expect.arrayContaining(['ADM', 'NEW']));
    });

    it('leaves out an inactive department', async () => {
      // A budget proposed for one could be approved into a department that no longer operates.
      const rows = await asCompany(() => budgets.listSelectableDepartments());
      expect(rows.map((d) => d.deptCode)).not.toContain('OLD');
    });

    it('never returns another company\'s department', async () => {
      const rows = await asCompany(() => budgets.listSelectableDepartments());
      expect(rows.map((d) => d.id)).not.toContain(ids.otherDept);
      // And from the other side: company B sees only its own.
      const fromB = await asCompany(() => budgets.listSelectableDepartments(), ids.other);
      expect(fromB.map((d) => d.deptCode)).toEqual(['BD']);
    });

    it('returns identifying fields only', async () => {
      const [row] = await asCompany(() => budgets.listSelectableDepartments());
      // A picker's option list has no business carrying anything else.
      expect(Object.keys(row).sort()).toEqual(['deptCode', 'id', 'name']);
    });
  });

  describe('the fiscal years a budget may be proposed for', () => {
    it('returns the active company\'s years, newest first', async () => {
      const rows = await asCompany(() => budgets.listSelectableFiscalYears());
      expect(rows.map((f) => f.year)).toEqual([2026, 2025]);
    });

    it('never returns another company\'s year', async () => {
      const rows = await asCompany(() => budgets.listSelectableFiscalYears());
      expect(rows.map((f) => f.id)).not.toContain(ids.fyOther);
    });

    it('carries the status, so the form can tell an open year from a closed one', async () => {
      const rows = await asCompany(() => budgets.listSelectableFiscalYears());
      expect(rows.find((f) => f.year === 2025)?.status).toBe('CLOSED');
      expect(rows.find((f) => f.year === 2026)?.status).toBe('OPEN');
    });

    it('returns identifying fields only — no figure of any kind', async () => {
      const [row] = await asCompany(() => budgets.listSelectableFiscalYears());
      expect(Object.keys(row).sort()).toEqual(['endDate', 'id', 'startDate', 'status', 'year']);
    });
  });
});
