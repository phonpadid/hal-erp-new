import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Company } from '../multi-company/multi-company.entities';
import { seedDatabase } from '../../seed/seed-data';
import { BudgetBalanceService } from './budget-balance.service';
import { BudgetService } from './budget.service';
import { AccountService } from '../accounting/account.service';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { Budget } from './budget.entities';
import { QuotaBalanceService } from '../quota/quota-balance.service';
import { Quota } from '../quota/quota.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Regression for the global-EntityManager 500: the read methods must fork their own
 * context when called without a transactional `em`, even when no MikroORM request
 * context is active (the controller path). Constructed with the ROOT em on purpose.
 */
describe.skipIf(!hasDb)('budget/quota reads are EM-context-safe (DB-backed)', () => {
  let orm: MikroORM;
  let budgetBalance: BudgetBalanceService;
  let budgets: BudgetService;
  let quotaBalance: QuotaBalanceService;
  let companyA = '';
  let budgetId = '';
  let quotaId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    // ROOT em (not a fork) — exactly what Nest injects; the methods must fork internally.
    budgetBalance = new BudgetBalanceService(orm.em);
    budgets = new BudgetService(orm.em, new AccountService(orm.em, new CompanyScopeService(orm.em)));
    quotaBalance = new QuotaBalanceService(orm.em);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: 'DEMO' }, FILTER_OFF)).id;
    budgetId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, FILTER_OFF)).id;
    quotaId = (await em.findOneOrFail(Quota, { quotaType: 'ANNUAL_LEAVE' }, FILTER_OFF)).id;
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: 'u', companyId: companyA, departmentId: '', grants: [] }, fn);

  it('budget breakdown/ledger/list/get succeed via the global em (no fork, no ORM context)', async () => {
    await asA(async () => {
      const b = await budgetBalance.breakdown(budgetId);
      expect(Number(b.amountTotal)).toBeGreaterThan(0);
      await expect(budgetBalance.ledger(budgetId).then((r) => r.items)).resolves.toBeInstanceOf(Array);
      await expect(budgetBalance.availableBalance(budgetId)).resolves.toBeTypeOf('string');
      await expect(budgets.list().then((r) => r.items)).resolves.toBeInstanceOf(Array);
      await expect(budgets.get(budgetId)).resolves.toBeTruthy();
    });
  });

  it('quota breakdown/usage succeed via the global em', async () => {
    await asA(async () => {
      const q = await quotaBalance.breakdown(quotaId);
      expect(q.quota.id).toBe(quotaId);
      await expect(quotaBalance.usageLedger(quotaId).then((r) => r.items)).resolves.toBeInstanceOf(Array);
    });
  });

  it('still honors an explicit (transactional) em when passed', async () => {
    await asA(async () => {
      const tem = orm.em.fork();
      await expect(budgetBalance.breakdown(budgetId, tem)).resolves.toBeTruthy();
      await expect(quotaBalance.netUsage(quotaId, undefined, tem)).resolves.toBeTypeOf('string');
    });
  });
});
