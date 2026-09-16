import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Scope } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { ScopeService } from '../rbac/scope.service';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetService } from './budget.service';
import { Budget, BudgetNode } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

/**
 * Which budgets the ITEM REGISTRY may bind an item to — the same question the document picker
 * answers by the caller's grant, asked of the read that had never been told the rule.
 *
 * `gl-options` was written before shared budgets existed and filtered by company and year alone.
 * The customer's IT staff role holds `MASTER_MANAGE` at DEPARTMENT, and its four holders were
 * offered ບໍລິຫານ's, ບັນຊີ's and Procurement's budgets beside their own, and could bind an item to
 * any of them. The rule here is the one `selectable-follows-the-grant` pins for `DOC_CREATE`,
 * keyed on `MASTER_VIEW` — the code this route is authorized by — so that marking a node shared
 * opens it in both pickers at once.
 *
 * The plan below is the same shape as that suite's, with an account on every budget: a budget
 * naming no account is not offered by this read at all, which is a separate rule with its own spec.
 */
describe.skipIf(!hasDb)('the budgets an item may be bound to (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  const ids = { company: '', admin: '', marketing: '', budgetOffice: '', fy: '' };

  /** A caller: which department they are in, and the scope `MASTER_VIEW` was granted at. */
  const as = <T>(departmentId: string, scope: Scope, fn: () => Promise<T>, companyId = ids.company) =>
    RequestContext.run(
      { companyId, departmentId, userId: 'u', grants: [{ code: 'MASTER_VIEW', scope }] },
      fn,
    );

  const codes = async (rows: Promise<Array<{ code: string }>>) =>
    (await rows).map((r) => r.code).sort();

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();

    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const other = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const admin = em.create(Department, { company, deptCode: 'ADM', name: 'Administration', isActive: true });
    const marketing = em.create(Department, { company, deptCode: 'MK', name: 'Marketing', isActive: true });
    const budgetOffice = em.create(Department, { company, deptCode: 'BG', name: 'Budget office', isActive: true });
    const otherDept = em.create(Department, { company: other, deptCode: 'BD', name: 'B dept', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyOther = em.create(FiscalYear, { company: other, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });

    const root = em.create(BudgetNode, { fiscalYear: fy, code: '1', name: 'Administration' });
    const sharedCat = em.create(BudgetNode, { fiscalYear: fy, code: '1.400', name: 'Monthly recurring', parent: root, isShared: true });
    const sharedLine = em.create(BudgetNode, { fiscalYear: fy, code: '1.406', name: 'Phone bills', parent: sharedCat });
    const privateCat = em.create(BudgetNode, { fiscalYear: fy, code: '1.200', name: 'Licences', parent: root });
    const adminLine = em.create(BudgetNode, { fiscalYear: fy, code: '1.201', name: 'Postal licence', parent: privateCat });
    const mkRoot = em.create(BudgetNode, { fiscalYear: fy, code: '3', name: 'Marketing' });
    const mkLine = em.create(BudgetNode, { fiscalYear: fy, code: '3.101', name: 'Advertising', parent: mkRoot });
    // Shared in company B — and company B is not the active company.
    const foreignRoot = em.create(BudgetNode, { fiscalYear: fyOther, code: '9', name: 'B plan', isShared: true });

    const budget = (node: BudgetNode, department: Department, fiscalYear: FiscalYear, glAccount: string) =>
      em.create(Budget, { fiscalYear, department, node, amountTotal: '1000000', status: 'ACTIVE', glAccount });

    budget(sharedLine, admin, fy, '641.01');   // shared, held by ADM
    budget(adminLine, admin, fy, '612.06');    // ADM's own
    budget(mkLine, marketing, fy, '651.01');   // MK's own
    budget(foreignRoot, otherDept, fyOther, '999.99');

    await em.persistAndFlush(company);
    Object.assign(ids, {
      company: company.id, admin: admin.id, marketing: marketing.id, budgetOffice: budgetOffice.id, fy: fy.id,
    });

    budgets = new BudgetService(
      orm.em,
      new AccountService(orm.em, new CompanyScopeService(orm.em)),
      new BudgetBalanceService(orm.em),
      new ScopeService(),
    );
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('the grant decides', () => {
    it('offers a DEPARTMENT-scope registrar their own department and no other department’s private money', async () => {
      const got = await codes(as(ids.marketing, Scope.DEPARTMENT, () => budgets.listGlOptions(ids.fy)));
      expect(got).toContain('3.101');       // its own
      expect(got).not.toContain('1.201');   // ADM's licences — private
    });

    it('offers a COMPANY-scope registrar every department’s budgets, as before', async () => {
      const got = await codes(as(ids.budgetOffice, Scope.COMPANY, () => budgets.listGlOptions(ids.fy)));
      expect(got).toEqual(['1.201', '1.406', '3.101']);
    });

    it('applies the grant when the read defaults the year, not only when one is named', async () => {
      // The controller passes the open year; the rule must not depend on that.
      const got = await codes(as(ids.marketing, Scope.DEPARTMENT, () => budgets.listGlOptions()));
      expect(got).toEqual(['1.406', '3.101']);
    });
  });

  describe('shared budgets', () => {
    it('reach a department that does not own them, marked as shared', async () => {
      const rows = await as(ids.marketing, Scope.DEPARTMENT, () => budgets.listGlOptions(ids.fy));
      const phone = rows.find((r) => r.code === '1.406');
      expect(phone).toBeDefined();
      expect(phone!.isShared).toBe(true);
      // `1.406` was never marked; `1.400` above it was — inheritance is what is under test.
    });

    it('widen a department’s list rather than replace it', async () => {
      const got = await codes(as(ids.admin, Scope.DEPARTMENT, () => budgets.listGlOptions(ids.fy)));
      expect(got).toEqual(['1.201', '1.406']);
    });

    it('leave a department’s own budgets unmarked, so the registrar can tell the two apart', async () => {
      const rows = await as(ids.admin, Scope.DEPARTMENT, () => budgets.listGlOptions(ids.fy));
      expect(rows.find((r) => r.code === '1.201')!.isShared).toBe(false);
      // And a COMPANY-scope reader sees the same mark: it describes the budget, not the caller.
      const all = await as(ids.budgetOffice, Scope.COMPANY, () => budgets.listGlOptions(ids.fy));
      expect(all.find((r) => r.code === '1.406')!.isShared).toBe(true);
      expect(all.find((r) => r.code === '3.101')!.isShared).toBe(false);
    });

    it('are ALL a registrar gets when their department owns nothing — an empty list, not a refusal, without them', async () => {
      const rows = await as(ids.budgetOffice, Scope.DEPARTMENT, () => budgets.listGlOptions(ids.fy));
      expect(rows.map((r) => r.code)).toEqual(['1.406']);
      expect(rows.every((r) => r.isShared)).toBe(true);
      // With no shared node the same caller would get nothing. Simulated by unmarking the
      // category — under the same em the service reads from, so nothing is cached in between.
      const em = orm.em.fork();
      const cat = await em.findOneOrFail(BudgetNode, { code: '1.400' }, { filters: { company: false } });
      cat.isShared = false;
      await em.flush();
      try {
        await expect(as(ids.budgetOffice, Scope.DEPARTMENT, () => budgets.listGlOptions(ids.fy))).resolves.toEqual([]);
      } finally {
        cat.isShared = true;
        await em.flush();
      }
    });

    it('do not cross a company', async () => {
      const got = await codes(as(ids.marketing, Scope.DEPARTMENT, () => budgets.listGlOptions(ids.fy)));
      expect(got).not.toContain('9');
    });
  });
});
