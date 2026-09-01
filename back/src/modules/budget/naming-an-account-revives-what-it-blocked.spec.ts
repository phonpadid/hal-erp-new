import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { attachCoverage, budgetAt } from '../../test/budget-fixture';
import { RequestContext } from '../../common/context/request-context';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { GlPostingStatus } from '../../common/enums';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { AccountService } from '../accounting/account.service';
import { Currency } from '../currency/currency.entities';
import { GlPostingAttempt } from '../gl/gl-posting.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { BudgetBalanceService } from './budget-balance.service';
import { Budget } from './budget.entities';
import { BudgetService } from './budget.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const FILTER_OFF = { filters: { company: false } } as const;
const hasDb = await dbAvailable();
const USER = '00000000-0000-0000-0000-000000000001';

/**
 * The bound on retries parks a posting at FAILED after five sweeps, and only `GL_POST_RETRY` could
 * return it — a code the accounting role does not hold, on a screen separate from the one that
 * fixes the cause. So a posting blocked for want of a budget's GL account stayed parked after the
 * account existed. The holder who fixes the cause clears the effect.
 */
describe.skipIf(!hasDb)('naming a budget account revives what it blocked (DB-backed)', () => {
  let orm: MikroORM;
  let budgets: BudgetService;
  const ids = { company: '', blocked: '', other: '', mapped: '' };

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const em = orm.em.fork();
    const cur = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const company = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: cur, isActive: true });
    const dept = em.create(Department, { company, deptCode: 'D', name: 'D', isActive: true });
    const y = new Date().getUTCFullYear();
    const fy = em.create(FiscalYear, { company, year: y, startDate: `${y}-01-01`, endDate: `${y}-12-31`, status: 'OPEN' });

    // The account the fix names. Postable, active, in this company.
    em.create(Account, { company, code: '5210', name: 'Utilities', accountType: 'EXPENSE' as never, isPostable: true, isActive: true });
    em.create(Account, { company, code: '5300', name: 'Repairs', accountType: 'EXPENSE' as never, isPostable: true, isActive: true });

    // Two budgets naming no account — the state that strands a posting — and one that already does.
    const blocked = budgetAt(em, { fiscalYear: fy, department: dept, code: '1.101', withoutAccount: true, budgetName: 'Office supplies', amountTotal: '100000', status: 'ACTIVE' });
    attachCoverage(em, company, blocked);
    const other = budgetAt(em, { fiscalYear: fy, department: dept, code: '1.106', withoutAccount: true, budgetName: 'Support', amountTotal: '100000', status: 'ACTIVE' });
    attachCoverage(em, company, other);
    const mapped = budgetAt(em, { fiscalYear: fy, department: dept, code: '1.201', glAccount: '5300', budgetName: 'Licences', amountTotal: '100000', status: 'ACTIVE' });
    attachCoverage(em, company, mapped);

    await em.flush();
    Object.assign(ids, { company: company.id, blocked: blocked.id, other: other.id, mapped: mapped.id });
  });

  afterAll(async () => {
    if (orm) {
      await orm.schema.dropSchema();
      await orm.close(true);
    }
  });

  beforeEach(async () => {
    const scope = new CompanyScopeService(orm.em);
    budgets = new BudgetService(orm.em, new AccountService(orm.em, scope), new BudgetBalanceService(orm.em));
    // Rebuild the attempts AND the budgets each time. These specs write for real now — that is the
    // point of half of them — so a budget one test gives an account to would arrive at the next
    // already mapped, and the refusal cases would be testing nothing.
    const em = orm.em.fork();
    await em.nativeDelete(GlPostingAttempt, {}, FILTER_OFF);
    await em.nativeUpdate(Budget, { id: { $in: [ids.blocked, ids.other] } }, { glAccount: null, account: null }, FILTER_OFF);
    for (const [i, budgetId] of [ids.blocked, ids.blocked, ids.other].entries()) {
      em.create(GlPostingAttempt, {
        company: em.getReference(Company, ids.company),
        sourceType: 'PAYMENT',
        sourceId: `00000000-0000-0000-0000-00000000000${i + 2}`,
        status: GlPostingStatus.FAILED,
        attempts: 5,
        lastError: 'Budget 1.101 names no GL account',
        blockedByBudget: em.getReference(Budget, budgetId),
        createdAt: new Date(),
      });
    }
    await em.flush();
  });

  function asCompany<T>(fn: () => Promise<T>): Promise<T> {
    return RequestContext.run({ userId: USER, companyId: ids.company, grants: [] }, fn);
  }

  async function attemptsFor(budgetId: string): Promise<GlPostingAttempt[]> {
    return orm.em.fork().find(GlPostingAttempt, { blockedByBudget: budgetId }, FILTER_OFF);
  }

  it('returns every posting that budget blocked to PENDING with attempts reset', async () => {
    await asCompany(() => budgets.update(ids.blocked, { glAccount: '5210' } as never));

    const revived = await attemptsFor(ids.blocked);
    expect(revived).toHaveLength(2);
    for (const row of revived) {
      expect(row.status).toBe(GlPostingStatus.PENDING);
      expect(row.attempts).toBe(0);
      // The record of what went wrong outlives the fix.
      expect(row.lastError).toBe('Budget 1.101 names no GL account');
    }
  });

  it('leaves a posting blocked by a different budget alone', async () => {
    await asCompany(() => budgets.update(ids.blocked, { glAccount: '5210' } as never));

    const untouched = await attemptsFor(ids.other);
    expect(untouched).toHaveLength(1);
    expect(untouched[0].status).toBe(GlPostingStatus.FAILED);
    expect(untouched[0].attempts).toBe(5);
  });

  it('actually writes the account, not only the code', async () => {
    // The column the ledger debits, and the one submit refuses a document without. Writing the
    // string alone left the budget exactly as unpostable as before.
    await asCompany(() => budgets.update(ids.blocked, { glAccount: '5210' } as never));

    const reread = await orm.em.fork().findOneOrFail(Budget, { id: ids.blocked }, { ...FILTER_OFF, populate: ['account'] });
    expect(reread.glAccount).toBe('5210');
    expect(reread.account?.code).toBe('5210');
  });

  it('re-queues nothing when an account is swapped for another', async () => {
    // Nothing was ever blocked on this budget: it named an account all along.
    await asCompany(() => budgets.update(ids.mapped, { glAccount: '5210' } as never));

    const stillFailed = await attemptsFor(ids.blocked);
    expect(stillFailed.every((r) => r.status === GlPostingStatus.FAILED)).toBe(true);
  });

  it('re-queues nothing when the update is refused', async () => {
    await expect(
      asCompany(() => budgets.update(ids.blocked, { glAccount: 'NOPE' } as never)),
    ).rejects.toThrow(/Unknown GL account/i);

    const stillFailed = await attemptsFor(ids.blocked);
    expect(stillFailed).toHaveLength(2);
    expect(stillFailed.every((r) => r.status === GlPostingStatus.FAILED)).toBe(true);
    const reread = await orm.em.fork().findOneOrFail(Budget, { id: ids.blocked }, FILTER_OFF);
    expect(reread.glAccount ?? null).toBeNull();
  });

  it('persists an ordinary edit — the flush reaches the database', async () => {
    // A regression guard, not a feature: this read through a fork and flushed a different entity
    // manager, so every budget edit was a silent no-op that still answered 200 with the new values.
    await asCompany(() => budgets.update(ids.mapped, { budgetName: 'Renamed' } as never));

    const reread = await orm.em.fork().findOneOrFail(Budget, { id: ids.mapped }, FILTER_OFF);
    expect(reread.budgetName).toBe('Renamed');
  });
});

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[naming-an-account-revives-what-it-blocked] no database reachable — skipping');
}
