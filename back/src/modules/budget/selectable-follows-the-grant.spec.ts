import 'reflect-metadata';
import { ForbiddenException, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Scope } from '../../common/enums';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { ScopeService } from '../rbac/scope.service';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetController } from './budget.controller';
import { BudgetNodeService } from './budget-node.service';
import { BudgetService } from './budget.service';
import { Budget, BudgetNode } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * Which budgets a document may charge — the question the picker was answering by itself, wrongly.
 *
 * It sent the signed-in user's own department, which hardcoded DEPARTMENT behaviour for everyone
 * however widely they had been granted, and enforced a rule nothing else in the system holds: the
 * server never compares a document's department with its line's budget, and control points govern
 * through the BUDGET's department. `LATTANAPHONE` holds `DOC_CREATE` at COMPANY and sits in
 * `ພະແນກງົບປະມານ`, which holds no budget because a budget department administers the plan rather
 * than spending it — so the person whose job is keying the year's spending could submit nothing.
 *
 * The second half is not about the user: much of the plan is money the whole company draws on.
 * `1.100 ຄ່າບໍລິຫານ ທົວໄປ` and `1.400 ລາຍຈ່າຍປະຈຳເດືອນ` hold the office supplies, the security
 * guards, the phone bills and the cleaning contract. An ordinary employee correctly scoped to their
 * own department still has to reach them.
 */
describe.skipIf(!hasDb)('the budgets a document may charge (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  let nodes: BudgetNodeService;
  const ids = {
    company: '', other: '',
    admin: '', marketing: '', budgetOffice: '', otherDept: '',
    fy: '', fyOther: '',
    ownOfAdmin: '', ownOfMarketing: '', sharedLine: '', sharedRoot: '', foreignShared: '',
  };

  /** A caller: which department they are in, and the scope `DOC_CREATE` was granted at. */
  const as = <T>(departmentId: string, scope: Scope, fn: () => Promise<T>, companyId = ids.company) =>
    RequestContext.run(
      { companyId, departmentId, userId: 'u', grants: [{ code: 'DOC_CREATE', scope }] },
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
    // Holds no budget, and correctly so: a budget department administers the plan.
    const budgetOffice = em.create(Department, { company, deptCode: 'BG', name: 'Budget office', isActive: true });
    const otherDept = em.create(Department, { company: other, deptCode: 'BD', name: 'B dept', isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const fyOther = em.create(FiscalYear, { company: other, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });

    // The plan, shaped like the customer's: a department root, a shared category beneath it, and
    // a private category beside that one.
    const root = em.create(BudgetNode, { fiscalYear: fy, code: '1', name: 'Administration' });
    const sharedCat = em.create(BudgetNode, { fiscalYear: fy, code: '1.400', name: 'Monthly recurring', parent: root });
    const sharedLine = em.create(BudgetNode, { fiscalYear: fy, code: '1.406', name: 'Phone bills', parent: sharedCat });
    const privateCat = em.create(BudgetNode, { fiscalYear: fy, code: '1.200', name: 'Licences', parent: root });
    const adminLine = em.create(BudgetNode, { fiscalYear: fy, code: '1.201', name: 'Postal licence', parent: privateCat });
    const mkRoot = em.create(BudgetNode, { fiscalYear: fy, code: '3', name: 'Marketing' });
    const mkLine = em.create(BudgetNode, { fiscalYear: fy, code: '3.101', name: 'Advertising', parent: mkRoot });
    const foreignRoot = em.create(BudgetNode, { fiscalYear: fyOther, code: '9', name: 'B plan', isShared: true });

    const budget = (node: BudgetNode, department: Department, fiscalYear: FiscalYear) =>
      em.create(Budget, { fiscalYear, department, node, amountTotal: '1000000', status: 'ACTIVE' });

    const sharedBudget = budget(sharedLine, admin, fy);   // shared, held by ADM
    const ownOfAdmin = budget(adminLine, admin, fy);      // ADM's own
    const ownOfMarketing = budget(mkLine, marketing, fy); // MK's own
    const foreign = budget(foreignRoot, otherDept, fyOther);

    // The mark goes on the CATEGORY, not the line, so inheritance is what is under test.
    sharedCat.isShared = true;

    await em.persistAndFlush(company);
    Object.assign(ids, {
      company: company.id, other: other.id,
      admin: admin.id, marketing: marketing.id, budgetOffice: budgetOffice.id, otherDept: otherDept.id,
      fy: fy.id, fyOther: fyOther.id,
      ownOfAdmin: ownOfAdmin.id, ownOfMarketing: ownOfMarketing.id,
      sharedLine: sharedBudget.id, sharedRoot: sharedCat.id, foreignShared: foreign.id,
    });

    const scope = new CompanyScopeService(orm.em);
    budgets = new BudgetService(
      orm.em,
      new AccountService(orm.em, scope),
      new BudgetBalanceService(orm.em),
      new ScopeService(),
    );
    nodes = new BudgetNodeService(orm.em, scope);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('the grant decides, not the client', () => {
    it('gives a DEPARTMENT-scope caller their own department and no other department’s private money', async () => {
      const got = await codes(as(ids.marketing, Scope.DEPARTMENT, () => budgets.listSelectable()));
      expect(got).toContain('3.101');       // its own
      expect(got).not.toContain('1.201');   // ADM's licences — private
    });

    it('gives a COMPANY-scope caller a NON-EMPTY list from a department holding no budget', async () => {
      // The regression, stated as the thing LATTANAPHONE could not do.
      const got = await codes(as(ids.budgetOffice, Scope.COMPANY, () => budgets.listSelectable()));
      expect(got).toEqual(['1.201', '1.406', '3.101']);
    });

    it('does not let a DEPARTMENT-scope caller widen itself by naming another department', async () => {
      const got = await codes(
        as(ids.marketing, Scope.DEPARTMENT, () => budgets.listSelectable(ids.admin)),
      );
      expect(got).not.toContain('1.201');
      expect(got).toContain('3.101');
    });

    it('lets a COMPANY-scope caller narrow to one department', async () => {
      const got = await codes(
        as(ids.budgetOffice, Scope.COMPANY, () => budgets.listSelectable(ids.marketing)),
      );
      expect(got).toEqual(['3.101']);
    });
  });

  describe('shared budgets', () => {
    it('reach a department that does not own them, marked as shared', async () => {
      const rows = await as(ids.marketing, Scope.DEPARTMENT, () => budgets.listSelectable());
      const phone = rows.find((r) => r.code === '1.406');
      expect(phone).toBeDefined();
      expect(phone!.isShared).toBe(true);
    });

    it('are inherited from the category, not marked line by line', async () => {
      // `1.406` was never marked; `1.400` above it was. That is the whole point of the subtree.
      const node = (
        await as(ids.admin, Scope.DEPARTMENT, () => nodes.list(ids.fy))
      ).find((x) => x.code === '1.406')!;
      expect(node.isShared).toBe(false);
      expect(node.sharedByAncestor).toBe(true);
    });

    it('do NOT replace a department’s own budgets', async () => {
      // The sentence heard backwards would take ADM's licences away from ADM.
      const got = await codes(as(ids.admin, Scope.DEPARTMENT, () => budgets.listSelectable()));
      expect(got).toEqual(['1.201', '1.406']);
    });

    it('leave a department’s own budgets unmarked', async () => {
      const rows = await as(ids.admin, Scope.DEPARTMENT, () => budgets.listSelectable());
      expect(rows.find((r) => r.code === '1.201')!.isShared).toBe(false);
    });

    it('keep their owning department and its governing control points', async () => {
      // Sharing says who may CHARGE, never who OWNS. If it moved the department, every control
      // point governing that budget would change with it.
      const b = await orm.em.fork().findOneOrFail(Budget, { id: ids.sharedLine }, { ...FILTER_OFF, populate: ['department'] });
      expect(b.department.id).toBe(ids.admin);
    });

    it('are ALL an ordinary employee gets when their department owns nothing', async () => {
      // The case scope alone cannot fix, and the one most of the customer's twenty departments are
      // in: correctly granted DEPARTMENT, holding no budget of their own, and still needing to pay
      // the phone bill. Exactly the shared money — not one line of anybody's private plan.
      const rows = await as(ids.budgetOffice, Scope.DEPARTMENT, () => budgets.listSelectable());
      expect(rows.map((r) => r.code)).toEqual(['1.406']);
      expect(rows.every((r) => r.isShared)).toBe(true);
    });

    it('do not cross a company', async () => {
      const got = await codes(as(ids.marketing, Scope.DEPARTMENT, () => budgets.listSelectable()));
      expect(got).not.toContain('9');
    });
  });

  describe('the gate', () => {
    const guard = new PermissionsGuard(new Reflector());
    const call = (cls: Type<unknown>, method: string, permissionCodes: string[]) =>
      guard.canActivate({
        getHandler: () => (cls.prototype as Record<string, never>)[method],
        getClass: () => cls,
        switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
      } as never);

    it('refuses marking a node without BUDGET_MANAGE', () => {
      expect(() => call(BudgetController, 'updateNode', ['BUDGET_VIEW', 'DOC_CREATE'])).toThrow(
        ForbiddenException,
      );
      expect(call(BudgetController, 'updateNode', ['BUDGET_MANAGE'])).toBe(true);
    });
  });
});
