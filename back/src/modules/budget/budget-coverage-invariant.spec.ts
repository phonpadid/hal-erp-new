import { BadRequestException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetControlPointService } from './budget-control-point.service';
import { BudgetCoverageService } from './budget-coverage.service';
import { BudgetService } from './budget.service';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();

/**
 * The coverage invariant (design.md D3): every ACTIVE budget must be governed by at least one
 * active control point.
 *
 * This is the enforcement whose absence is invisible. An uncovered budget raises no error when
 * it is spent against — it simply stops being checked — so one careless configuration edit could
 * disable budget control across a company with nothing in the logs to show for it.
 */
describe.skipIf(!hasDb)('budget coverage invariant (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  let controlPoints: BudgetControlPointService;
  let coverage: BudgetCoverageService;

  const ids = { company: '', dept: '', deptChild: '', fy: '' };
  let seq = 0;

  function asCtx<T>(fn: () => Promise<T>, companyId = ids.company): Promise<T> {
    return RequestContext.run({ companyId, departmentId: ids.dept, grants: [] }, fn);
  }

  async function account(code: string, opts: { postable?: boolean } = {}) {
    const em = orm.em.fork();
    const a = em.create(Account, {
      company: em.getReference(Company, ids.company),
      code,
      name: code,
      accountType: 'EXPENSE' as never,
      isPostable: opts.postable ?? true,
      isActive: true,
    });
    await em.persistAndFlush(a);
    return a;
  }

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    const em = orm.em.fork();
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const deptChild = em.create(Department, { company, deptCode: 'DC', name: 'DC', parentDept: dept, isActive: true });
    const fy = em.create(FiscalYear, { company, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    await em.persistAndFlush(company);
    Object.assign(ids, { company: company.id, dept: dept.id, deptChild: deptChild.id, fy: fy.id });

    const scope = new CompanyScopeService(orm.em as EntityManager);
    const accounts = new AccountService(orm.em as EntityManager, scope);
    const balance = new BudgetBalanceService(orm.em as EntityManager);
    coverage = new BudgetCoverageService(orm.em as EntityManager);
    budgets = new BudgetService(orm.em as EntityManager, accounts, balance, coverage);
    controlPoints = new BudgetControlPointService(orm.em as EntityManager, coverage, balance);
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  describe('creating a budget', () => {
    it('creates a self-scoped control point when nothing governs it yet', async () => {
      const code = `5${seq++}00`;
      await account(code);
      const budget = await asCtx(() =>
        budgets.create({
          fiscalYearId: ids.fy,
          departmentId: ids.deptChild,
          glAccount: code,
          amountTotal: '100000',
        } as never),
      );
      const governing = await coverage.controlPointsFor(budget.id);
      expect(governing).toHaveLength(1);
      expect(governing[0].departmentNodeId).toBe(ids.deptChild);
    });

    it('adds no control point when an existing one already governs the budget', async () => {
      const code = `5${seq++}00`;
      const acc = await account(code);
      // A department-level point that already covers everything under `dept`.
      await asCtx(() =>
        controlPoints.create({
          fiscalYearId: ids.fy,
          accountNodeId: acc.id,
          departmentNodeId: ids.dept,
          tolerance: [{ at: 100, action: 'BLOCK' }],
        }),
      );
      const budget = await asCtx(() =>
        budgets.create({
          fiscalYearId: ids.fy,
          departmentId: ids.deptChild,
          glAccount: code,
          amountTotal: '100000',
        } as never),
      );
      const governing = await coverage.controlPointsFor(budget.id);
      expect(governing).toHaveLength(1);
      // The pre-existing wider point, not a freshly minted self-scoped one.
      expect(governing[0].departmentNodeId).toBe(ids.dept);
    });

    it('leaves no ACTIVE budget uncovered, whichever path created it', async () => {
      const em = orm.em.fork();
      const all = await em.find(
        (await import('./budget.entities')).Budget,
        { status: 'ACTIVE' },
        FILTER_OFF,
      );
      for (const b of all) {
        expect((await coverage.controlPointsFor(b.id)).length).toBeGreaterThan(0);
      }
    });
  });

  describe('deactivating a control point', () => {
    it('is refused when it is the last one covering an ACTIVE budget', async () => {
      const code = `5${seq++}00`;
      await account(code);
      const budget = await asCtx(() =>
        budgets.create({
          fiscalYearId: ids.fy,
          departmentId: ids.deptChild,
          glAccount: code,
          amountTotal: '100000',
        } as never),
      );
      const only = (await coverage.controlPointsFor(budget.id))[0];
      await expect(asCtx(() => controlPoints.deactivate(only.id))).rejects.toThrow(
        BadRequestException,
      );
      // ...and it is still active, so the budget is still checked.
      expect((await coverage.controlPointsFor(budget.id)).map((c) => c.id)).toContain(only.id);
    });

    it('is allowed when another control point still covers the budget', async () => {
      const code = `5${seq++}00`;
      const acc = await account(code);
      const budget = await asCtx(() =>
        budgets.create({
          fiscalYearId: ids.fy,
          departmentId: ids.deptChild,
          glAccount: code,
          amountTotal: '100000',
        } as never),
      );
      const selfScoped = (await coverage.controlPointsFor(budget.id))[0];
      await asCtx(() =>
        controlPoints.create({
          fiscalYearId: ids.fy,
          accountNodeId: acc.id,
          departmentNodeId: ids.dept,
          tolerance: [{ at: 100, action: 'BLOCK' }],
        }),
      );
      await expect(asCtx(() => controlPoints.deactivate(selfScoped.id))).resolves.toBeDefined();
      const left = await coverage.controlPointsFor(budget.id);
      expect(left).toHaveLength(1);
      expect(left[0].id).not.toBe(selfScoped.id);
    });
  });

  describe('control point administration', () => {
    it('rejects a non-null cap_amount', async () => {
      const acc = await account(`5${seq++}00`);
      await expect(
        asCtx(() =>
          controlPoints.create({
            fiscalYearId: ids.fy,
            accountNodeId: acc.id,
            departmentNodeId: ids.dept,
            tolerance: [{ at: 100, action: 'BLOCK' }],
            capAmount: '1000' as never,
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an empty tolerance ladder', async () => {
      const acc = await account(`5${seq++}00`);
      await expect(
        asCtx(() =>
          controlPoints.create({
            fiscalYearId: ids.fy,
            accountNodeId: acc.id,
            departmentNodeId: ids.dept,
            tolerance: [],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a node belonging to another company', async () => {
      const em = orm.em.fork();
      const other = em.create(Company, { code: 'Z', nameTh: 'Z', taxId: '9', branchCode: '00000', isActive: true });
      const otherAcc = em.create(Account, {
        company: other, code: 'Z1', name: 'Z1', accountType: 'EXPENSE' as never,
        isPostable: true, isActive: true,
      });
      await em.persistAndFlush(other);
      await expect(
        asCtx(() =>
          controlPoints.create({
            fiscalYearId: ids.fy,
            accountNodeId: otherAcc.id,
            departmentNodeId: ids.dept,
            tolerance: [{ at: 100, action: 'BLOCK' }],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('lists only the active company’s control points', async () => {
      const listed = await asCtx(() => controlPoints.list());
      expect(listed.length).toBeGreaterThan(0);
      const em = orm.em.fork();
      const { BudgetControlPoint } = await import('./budget.entities');
      for (const view of listed) {
        const row = await em.findOneOrFail(BudgetControlPoint, { id: view.id }, {
          ...FILTER_OFF,
          populate: ['company'],
        });
        expect(row.company.id).toBe(ids.company);
      }
    });
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[budget-coverage-invariant] no database reachable — skipping DB-backed spec');
}
