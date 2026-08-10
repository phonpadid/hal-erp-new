import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountType, ControlPolicy } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetService } from '../budget/budget.service';
import { Budget } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AccountService } from './account.service';
import { Account } from './accounting.entities';
import type { MikroORM } from '@mikro-orm/postgresql';
import { BudgetBalanceService } from '../budget/budget-balance.service';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

describe.skipIf(!hasDb)('chart of accounts: resolver, integrity, isolation (DB-backed)', () => {
  let orm: MikroORM;
  let accounts: AccountService;
  let budgets: BudgetService;
  let companyA = '';
  let companyB = '';
  let fyAId = '';
  let deptAId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const scope = new CompanyScopeService(orm.em);
    accounts = new AccountService(orm.em, scope);
    budgets = new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em), new BudgetCoverageService(orm.em));

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', symbol: '฿', decimalPlaces: 2, isActive: true });
    const compA = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const compB = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const deptA = em.create(Department, { company: compA, deptCode: 'PROC', name: 'Proc A', isActive: true });
    const fyA = em.create(FiscalYear, { company: compA, year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', status: 'OPEN' });
    await em.flush();
    companyA = compA.id; companyB = compB.id; fyAId = fyA.id; deptAId = deptA.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ companyId: companyA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ companyId: companyB, grants: [] }, fn);

  it('creates accounts and enforces per-company code uniqueness', async () => {
    await asA(() => accounts.create({ code: '5000', name: 'Office Supplies', accountType: AccountType.EXPENSE }));
    await expect(asA(() => accounts.create({ code: '5000', name: 'Dup', accountType: AccountType.EXPENSE }))).rejects.toThrow(/already exists/);
    // Same code in a different company is fine.
    await expect(asB(() => accounts.create({ code: '5000', name: 'B Office', accountType: AccountType.EXPENSE }))).resolves.toBeDefined();
  });

  it('resolvePostable returns active+postable and rejects the bad cases', async () => {
    await asA(() => accounts.create({ code: '1000', name: 'Cash', accountType: AccountType.ASSET }));
    await asA(() => accounts.create({ code: '1900', name: 'Summary', accountType: AccountType.ASSET, isPostable: false }));
    await asA(() => accounts.create({ code: '1800', name: 'Old', accountType: AccountType.ASSET, isActive: false }));

    const acc = await asA(() => accounts.resolvePostable('1000'));
    expect(acc.code).toBe('1000');
    await expect(asA(() => accounts.resolvePostable('9999'))).rejects.toThrow(/Unknown GL account '9999'/);
    await expect(asA(() => accounts.resolvePostable('1900'))).rejects.toThrow(/not postable/);
    await expect(asA(() => accounts.resolvePostable('1800'))).rejects.toThrow(/inactive/);
    // Company A's account is invisible from company B.
    await expect(asB(() => accounts.resolvePostable('1000'))).rejects.toThrow(/Unknown GL account/);
  });

  it('enforces same-company + same-type parent and rejects cycles', async () => {
    const parent = await asA(() => accounts.create({ code: '6000', name: 'Expenses', accountType: AccountType.EXPENSE, isPostable: false }));
    // Same type parent is accepted.
    const child = await asA(() => accounts.create({ code: '6100', name: 'Travel', accountType: AccountType.EXPENSE, parentId: parent.id }));
    // Different type parent is rejected.
    await expect(asA(() => accounts.create({ code: '6200', name: 'Bad', accountType: AccountType.ASSET, parentId: parent.id }))).rejects.toThrow(/same account type/);
    // Cross-company parent is invisible → rejected.
    await expect(asB(() => accounts.create({ code: '6300', name: 'X', accountType: AccountType.EXPENSE, parentId: parent.id }))).rejects.toThrow(/not found in this company/);
    // Cycle: make the parent point at its own child.
    await expect(asA(() => accounts.update(parent.id, { parentId: child.id }))).rejects.toThrow(/cycle/);
  });

  it('lists only the active company accounts', async () => {
    const listA = await asA(() => accounts.list({ limit: 100 }, true));
    const listB = await asB(() => accounts.list({ limit: 100 }, true));
    expect(listA.items.every((a) => a.company.id === companyA)).toBe(true);
    expect(listB.items.every((a) => a.company.id === companyB)).toBe(true);
  });

  it('budget-create rejects an unresolved GL and persists code + account_id on success', async () => {
    await expect(
      asA(() => budgets.create({ fiscalYearId: fyAId, departmentId: deptAId, glAccount: 'NOPE', amountTotal: '1000', controlPolicy: ControlPolicy.HARD_STOP })),
    ).rejects.toThrow(/Unknown GL account 'NOPE'/);

    const created = await asA(() => budgets.create({ fiscalYearId: fyAId, departmentId: deptAId, glAccount: '5000', amountTotal: '1000', controlPolicy: ControlPolicy.HARD_STOP }));
    const reread = await orm.em.fork().findOneOrFail(Budget, { id: created.id }, { ...FILTER_OFF, populate: ['account'] });
    expect(reread.glAccount).toBe('5000');
    expect(reread.account?.code).toBe('5000');
  });
});
