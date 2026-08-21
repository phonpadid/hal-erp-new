import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { budgetAt } from '../../test/budget-fixture';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Currency } from '../currency/currency.entities';
import { DocumentType } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import {seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';
import { AccountService } from '../accounting/account.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Budget } from './budget.entities';
import type { MikroORM } from '@mikro-orm/postgresql';
import { BudgetBalanceService } from '../budget/budget-balance.service';

const FILTER_OFF = { filters: { company: false } } as const;

// --- Permission gate: DOC_CREATE, not BUDGET_VIEW (no DB needed) --------------------------
describe('GET /budgets/selectable permission gate', () => {
  const guard = new PermissionsGuard(new Reflector());
  const handler = BudgetController.prototype.listSelectable;
  const ctx = (permissionCodes: string[]) =>
    ({
      getHandler: () => handler,
      getClass: () => BudgetController,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
    }) as any;

  it('allows a creator holding DOC_CREATE without BUDGET_VIEW', () => {
    expect(guard.canActivate(ctx(['DOC_CREATE']))).toBe(true);
  });

  it('denies a user holding only BUDGET_VIEW (wrong code for this route)', () => {
    expect(() => guard.canActivate(ctx(['BUDGET_VIEW']))).toThrow(ForbiddenException);
  });

  it('denies a user with neither DOC_CREATE nor BUDGET_VIEW', () => {
    expect(() => guard.canActivate(ctx([]))).toThrow(ForbiddenException);
  });
});

// The resolve-budget read had its own permission gate tested here. The read is gone: it resolved
// THE budget for a `(gl_account, department, fiscal year)` triple, and that triple no longer
// identifies one — the customer's books put fuel, repairs and registration budgets on a single
// account inside one department, so a read returning "the" budget for an account would have to pick
// one arbitrarily. A line names its budget through the selectable read above, which is gated by the
// same `DOC_CREATE` code and is still tested for it.

// --- Movement doc-types read is gated by BUDGET_MANAGE -------------------------------------
describe('GET /budgets/movement-doc-types permission gate', () => {
  const guard = new PermissionsGuard(new Reflector());
  const handler = BudgetController.prototype.movementDocTypes;
  const ctx = (permissionCodes: string[]) =>
    ({
      getHandler: () => handler,
      getClass: () => BudgetController,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
    }) as any;

  it('allows BUDGET_MANAGE and denies otherwise', () => {
    expect(guard.canActivate(ctx(['BUDGET_MANAGE']))).toBe(true);
    expect(() => guard.canActivate(ctx(['BUDGET_VIEW']))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx([]))).toThrow(ForbiddenException);
  });
});

// --- Read behaviour: projection, company scope, ACTIVE-only (DB-backed) --------------------
const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('selectable budgets read (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  let companyA = '';
  let activeAId = '';
  let inactiveAId = '';
  let budgetBId = '';
  let deptAId = '';
  let otherDeptBudgetId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    budgets = new BudgetService(orm.em, new AccountService(orm.em, new CompanyScopeService(orm.em)), new BudgetBalanceService(orm.em));

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    activeAId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, { ...FILTER_OFF, populate: ['fiscalYear'] })).id;

    // An INACTIVE budget in company A — must be excluded from the picker.
    const deptA = await em.findOneOrFail(Department, { company: companyA, deptCode: 'PROC' }, FILTER_OFF);
    const fyA = await em.findOneOrFail(FiscalYear, { company: companyA }, FILTER_OFF);
    const inactive = budgetAt(em, { fiscalYear: fyA, department: deptA, code: '5999', glAccount: '5999', budgetName: 'Closed', amountTotal: '10000', status: 'INACTIVE' });

    // A second company with its own ACTIVE budget — must never be visible from company A.
    const thb = await em.findOneOrFail(Currency, { code: 'THB' }, FILTER_OFF);
    const compB = em.create(Company, { code: 'DEMO2', nameTh: 'บีโค', nameEn: 'B Co', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const deptB = em.create(Department, { company: compB, deptCode: 'PROC', name: 'Proc B', isActive: true });
    const fyB = em.create(FiscalYear, { company: compB, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    const budgetB = budgetAt(em, { fiscalYear: fyB, department: deptB, code: '5000', glAccount: '5000', budgetName: 'B budget', amountTotal: '500000', status: 'ACTIVE' });
    // A second department in company A with its own ACTIVE budget, so "narrows to a department"
    // can be told apart from "returns everything".
    const otherDept = em.create(Department, { company: em.getReference(Company, companyA), deptCode: 'ADMIN2', name: 'Admin 2', isActive: true });
    const otherDeptBudget = budgetAt(em, { fiscalYear: fyA, department: otherDept, code: '5100', glAccount: '5100', budgetName: 'Admin supplies', amountTotal: '20000', status: 'ACTIVE' });
    await em.flush();
    inactiveAId = inactive.id;
    budgetBId = budgetB.id;
    deptAId = deptA.id;
    otherDeptBudgetId = otherDeptBudget.id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('returns only id/code/budgetName/parentId — no amount or balance fields', async () => {
    // The GL account left this projection with the identity: a requester picks a budget by the
    // code of the node its money sits at, and several budgets legitimately share one account, so
    // an account would name several of these rows at once.
    const rows = await asA(() => budgets.listSelectable());
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['budgetName', 'code', 'id', 'parentId']);
      const bag = r as unknown as Record<string, unknown>;
      expect(bag.amountTotal).toBeUndefined();
      expect(bag.available).toBeUndefined();
      expect(bag.status).toBeUndefined();
    }
  });

  it('is scoped to the active company', async () => {
    const rows = await asA(() => budgets.listSelectable());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(activeAId);
    expect(ids).not.toContain(budgetBId);
  });

  it('excludes budgets whose status is not ACTIVE', async () => {
    const rows = await asA(() => budgets.listSelectable());
    expect(rows.map((r) => r.id)).not.toContain(inactiveAId);
  });

  it('narrows to one department when the caller names one', async () => {
    // A requester offered every department's budgets is offered choices their own document cannot
    // carry — and with a real plan the list is long enough that the wrong one is easy to pick.
    const all = await asA(() => budgets.listSelectable());
    expect(all.map((r) => r.id)).toContain(otherDeptBudgetId);

    const mine = await asA(() => budgets.listSelectable(deptAId));
    expect(mine.map((r) => r.id)).toContain(activeAId);
    expect(mine.map((r) => r.id)).not.toContain(otherDeptBudgetId);
  });
});

// --- Movement doc-types read: grouping, company scope, ACTIVE-only (DB-backed) -------------
describe.skipIf(!hasDb)('movement doc-types read (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  let companyA = '';
  let transferActiveId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    // Self-contained fixtures (no seed dependency): company A with one increase, one decrease,
    // one active + one inactive transfer type; company B with its own transfer type.
    const compA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const compB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', isActive: true });
    const mkType = (company: Company, code: string, postAction: string, isActive = true) =>
      em.create(DocumentType, { company, code, name: code, category: 'FINANCE' as any,
        requiresBudget: false, requiresQuota: false, requiresVendor: false, requiresItem: false,
        isActive, postAction });
    mkType(compA, 'INC_A', 'ADJUST_INCREASE');
    mkType(compA, 'DEC_A', 'ADJUST_DECREASE');
    const xferA = mkType(compA, 'XFER_A', 'TRANSFER');
    mkType(compA, 'XFER_A_OFF', 'TRANSFER', false); // inactive → excluded
    mkType(compB, 'XFER_B', 'TRANSFER'); // other company → excluded
    await em.flush();
    companyA = compA.id;
    transferActiveId = xferA.id;
    budgets = new BudgetService(orm.em, new AccountService(orm.em, new CompanyScopeService(orm.em)), new BudgetBalanceService(orm.em));
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('groups active types by operation, scoped to the active company', async () => {
    const groups = await asA(() => budgets.listMovementDocTypes());
    expect(groups.adjustIncrease.map((t) => t.code)).toEqual(['INC_A']);
    expect(groups.adjustDecrease.map((t) => t.code)).toEqual(['DEC_A']);
    // Only the active company-A transfer type — inactive and company-B types are excluded.
    expect(groups.transfer.map((t) => t.code)).toEqual(['XFER_A']);
    expect(groups.transfer[0].id).toBe(transferActiveId);
  });

  it('returns only id/code/name selection fields', async () => {
    const groups = await asA(() => budgets.listMovementDocTypes());
    for (const t of [...groups.adjustIncrease, ...groups.adjustDecrease, ...groups.transfer]) {
      expect(Object.keys(t).sort()).toEqual(['code', 'id', 'name']);
    }
  });
});
