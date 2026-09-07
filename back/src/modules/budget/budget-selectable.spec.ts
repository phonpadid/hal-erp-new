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
import { Budget, BudgetNode } from './budget.entities';
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

// --- The item-master picker is gated by MASTER_VIEW, not BUDGET_VIEW -----------------------
describe('GET /budgets/gl-options permission gate', () => {
  const guard = new PermissionsGuard(new Reflector());
  const handler = BudgetController.prototype.listGlOptions;
  const ctx = (permissionCodes: string[]) =>
    ({
      getHandler: () => handler,
      getClass: () => BudgetController,
      switchToHttp: () => ({ getRequest: () => ({ user: { permissionCodes } }) }),
    }) as any;

  it('allows a master-data reader without BUDGET_VIEW', () => {
    // Whoever maintains the item registry names the account an item posts to, and the budget is
    // only how they say it — the read carries no figures, so it must not demand the figure gate.
    expect(guard.canActivate(ctx(['MASTER_VIEW']))).toBe(true);
  });

  it('denies a user holding only BUDGET_VIEW (wrong code for this route)', () => {
    expect(() => guard.canActivate(ctx(['BUDGET_VIEW']))).toThrow(ForbiddenException);
  });

  it('denies a user with neither', () => {
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
  let categoryNodeId = '';
  let childBudgetId = '';
  let noGlBudgetId = '';
  let fyAId = '';

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

    // A budget under a CATEGORY node — the shape 85 of the customer's 92 budgets have. The category
    // holds no money, so it is never itself a selectable budget and never comes back from this
    // read; its code and name have to travel on the child or the caller cannot name it.
    const category = em.create(BudgetNode, { fiscalYear: fyA, code: '5.2', name: 'Travel' });
    const childNode = em.create(BudgetNode, { fiscalYear: fyA, code: '5.201', name: 'Travel — ops', parent: category });
    const childBudget = em.create(Budget, {
      fiscalYear: fyA, department: deptA, node: childNode, glAccount: '5201',
      budgetName: 'Travel — ops', amountTotal: '30000', status: 'ACTIVE',
    } as never);
    // A budget that names NO account — a vehicle instalment splits into principal and interest, so
    // there is no single account it could give an item. The GL picker must skip it, not offer it.
    const noGlNode = em.create(BudgetNode, { fiscalYear: fyA, code: '6.100', name: 'Vehicle instalment' });
    const noGlBudget = em.create(Budget, {
      fiscalYear: fyA, department: deptA, node: noGlNode,
      budgetName: 'Vehicle instalment', amountTotal: '40000', status: 'ACTIVE',
    } as never);
    await em.flush();
    noGlBudgetId = noGlBudget.id;
    fyAId = fyA.id;
    categoryNodeId = category.id;
    childBudgetId = childBudget.id;
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

  it('returns only selection fields — no amount or balance fields', async () => {
    // The GL account left this projection with the identity: a requester picks a budget by the
    // code of the node its money sits at, and several budgets legitimately share one account, so
    // an account would name several of these rows at once.
    //
    // The category's code and name joined the shape so the picker can group, and `glAccount` so it
    // can offer the obvious budget as a default; both are LABELS, not figures. This assertion is
    // the guard on that distinction — the read is gated on DOC_CREATE rather than BUDGET_VIEW, so
    // anything derived from `amount_total` or `budget_txn` appearing here would hand budget figures
    // to a requester who may not read them.
    const rows = await asA(() => budgets.listSelectable());
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      // `isShared` joined the shape for the same reason the category did: it is a fact ABOUT the
      // budget that a requester needs before charging it — money the company holds in common looks
      // exactly like their own department's from a code and a name — and it is not a figure.
      expect(Object.keys(r).sort()).toEqual([
        'budgetName', 'code', 'glAccount', 'id', 'isShared', 'parentCode', 'parentId', 'parentName',
      ]);
      const bag = r as unknown as Record<string, unknown>;
      expect(bag.amountTotal).toBeUndefined();
      expect(bag.available).toBeUndefined();
      expect(bag.status).toBeUndefined();
    }
  });

  it('names the account a budget posts to', async () => {
    // The client matches this against `item_company.default_gl_account` to prefill a line's budget
    // when exactly one budget carries the item's account. An account CODE, never a figure — the
    // assertion above is what keeps that line drawn.
    const rows = await asA(() => budgets.listSelectable());
    const withAccount = rows.find((r) => r.id === activeAId);
    expect(withAccount).toBeDefined();
    expect(withAccount!.glAccount).toBe('5000');
  });

  it('names no account for a budget whose spending splits across several', async () => {
    // A vehicle instalment splits into principal and interest, so there is no single account this
    // budget could offer. Undefined, not '': an empty string would match an item that has no GL
    // either, and the client's prefill would pair the two.
    const rows = await asA(() => budgets.listSelectable());
    const noAccount = rows.find((r) => r.id === noGlBudgetId);
    expect(noAccount).toBeDefined();
    expect(noAccount!.glAccount).toBeUndefined();
  });

  it('names the category a budget sits under, though the category is not itself selectable', async () => {
    const rows = await asA(() => budgets.listSelectable());
    const child = rows.find((r) => r.id === childBudgetId);
    expect(child).toBeDefined();
    expect(child!.parentCode).toBe('5.2');
    expect(child!.parentName).toBe('Travel');

    // The category holds no money, so it is not a budget and must not appear as one — which is
    // exactly why its name has to ride on the child.
    expect(rows.map((r) => r.id)).not.toContain(categoryNodeId);
    expect(rows.some((r) => r.code === '5.2')).toBe(false);
  });

  it('carries no category for a budget whose node has no parent', async () => {
    const rows = await asA(() => budgets.listSelectable());
    const rootLevel = rows.find((r) => r.id === activeAId);
    expect(rootLevel).toBeDefined();
    // Absent, not empty: "has no category" stays distinguishable from "has one with no name".
    expect(rootLevel!.parentId).toBeUndefined();
    expect(rootLevel!.parentCode).toBeUndefined();
    expect(rootLevel!.parentName).toBeUndefined();
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

  // --- The item-master GL picker reads the same plan, by account ---------------------------
  //
  // The item registry stores an ACCOUNT (`item_company.default_gl_account`) and asks for it in
  // budgets, because that is the name an admin knows it by. So this read is keyed by account, and
  // several rows sharing one is the expected shape, not a defect: a single account is charged by
  // fuel, repairs and registration budgets inside one department.

  it('reports the account each budget posts to, with no figures', async () => {
    const rows = await asA(() => budgets.listGlOptions(fyAId));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['budgetName', 'code', 'departmentName', 'glAccount']);
      // Gated on MASTER_VIEW: a master-data admin need not be able to read budget figures to name
      // an account, so nothing derived from amount_total or budget_txn may ride along.
      const bag = r as unknown as Record<string, unknown>;
      expect(bag.amountTotal).toBeUndefined();
      expect(bag.available).toBeUndefined();
    }
    // The department travels because the same category name recurs across departments, and a name
    // repeated four times with nothing to tell the rows apart is not a choice.
    expect(rows.some((r) => r.glAccount === '5000' && r.departmentName.length > 0)).toBe(true);
  });

  it('omits a budget that names no account rather than returning it unusable', async () => {
    // A budget records no account exactly when its spending posts to several, so there is nothing
    // it could give an item. Returning it would put an option in the picker that sets nothing.
    const rows = await asA(() => budgets.listGlOptions(fyAId));
    expect(rows.every((r) => !!r.glAccount)).toBe(true);
    expect(rows.some((r) => r.budgetName === 'Vehicle instalment')).toBe(false);
    // The row exists and is ACTIVE — it is skipped for the missing account, not for being absent.
    const em = orm.em.fork();
    expect((await em.findOneOrFail(Budget, { id: noGlBudgetId }, FILTER_OFF)).status).toBe('ACTIVE');
  });

  it('excludes budgets whose status is not ACTIVE', async () => {
    const rows = await asA(() => budgets.listGlOptions(fyAId));
    expect(rows.map((r) => r.glAccount)).not.toContain('5999');
  });

  it('narrows to the fiscal year the caller names, and stays in the active company otherwise', async () => {
    // One year at a time: a budget's identity is per-year, so every year it has ever existed would
    // contribute a row setting the same account — repetition with no choice in it.
    const scoped = await asA(() => budgets.listGlOptions(fyAId));
    expect(scoped.map((r) => r.glAccount)).toContain('5100');

    // Company B's ACTIVE budget shares account 5000 with A's and must never leak across (invariant
    // 1) — checked on the unnarrowed call, where only the company scope is doing the work.
    const all = await asA(() => budgets.listGlOptions());
    expect(all.some((r) => r.budgetName === 'B budget')).toBe(false);
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
