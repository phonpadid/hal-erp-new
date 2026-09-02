import { BudgetCoverageService } from '../budget/budget-coverage.service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { BudgetNodeService } from '../budget/budget-node.service';
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
  let nodes: BudgetNodeService;
  let companyA = '';
  let companyB = '';
  let fyAId = '';
  let deptAId = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();

    const scope = new CompanyScopeService(orm.em);
    accounts = new AccountService(orm.em, scope);
    budgets = new BudgetService(orm.em, accounts, new BudgetBalanceService(orm.em));
    nodes = new BudgetNodeService(orm.em, scope);

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

  it('enforces same-company parent and rejects cycles', async () => {
    const parent = await asA(() => accounts.create({ code: '6000', name: 'Expenses', accountType: AccountType.EXPENSE, isPostable: false }));
    const child = await asA(() => accounts.create({ code: '6100', name: 'Travel', accountType: AccountType.EXPENSE, parentId: parent.id }));
    // Cross-company parent is invisible → rejected.
    await expect(asB(() => accounts.create({ code: '6300', name: 'X', accountType: AccountType.EXPENSE, parentId: parent.id }))).rejects.toThrow(/not found in this company/);
    // Cycle: make the parent point at its own child.
    await expect(asA(() => accounts.update(parent.id, { parentId: child.id }))).rejects.toThrow(/cycle/);
  });

  it('accepts a contra account filed under a head of another type', async () => {
    // The customer's own chart, read literally: `752.01` is an ASSET sitting under `752`, a
    // REVENUE head — the receivable that offsets it, filed where an accountant looks for it. This
    // shape was rejected until now, which would have kept 46 of their 4,083 accounts out.
    const head = await asA(() => accounts.create({ code: '752', name: 'ລາຍຮັບ', accountType: AccountType.REVENUE, isPostable: false }));
    const contra = await asA(() =>
      accounts.create({ code: '752.01', name: 'ຊັບສິນ', accountType: AccountType.ASSET, parentId: head.id }),
    );
    expect(contra.parent?.id).toBe(head.id);
    // And it KEEPS its own type — the parent does not restamp the child.
    expect(contra.accountType).toBe(AccountType.ASSET);
  });

  it('lets an account change type without disturbing its parent', async () => {
    // This used to re-validate the unchanged parent against the new type and refuse. A parent that
    // did not move cannot have become a cycle, and the types no longer have to agree.
    const head = await asA(() => accounts.create({ code: '708', name: 'Head', accountType: AccountType.REVENUE, isPostable: false }));
    const leaf = await asA(() => accounts.create({ code: '7081', name: 'Leaf', accountType: AccountType.REVENUE, parentId: head.id }));
    const moved = await asA(() => accounts.update(leaf.id, { accountType: AccountType.ASSET }));
    expect(moved.accountType).toBe(AccountType.ASSET);
    expect(moved.parent?.id).toBe(head.id);
  });

  it('lists only the active company accounts', async () => {
    const listA = await asA(() => accounts.list({ limit: 100 }, true));
    const listB = await asB(() => accounts.list({ limit: 100 }, true));
    expect(listA.items.every((a) => a.company.id === companyA)).toBe(true);
    expect(listB.items.every((a) => a.company.id === companyB)).toBe(true);
  });

  it('budget-create rejects an unresolved GL and stamps account_id on success', async () => {
    // The account is a HINT now, not the budget's identity — but a hint that names an account
    // which does not exist is still a mistake worth refusing, and when it does exist the row it
    // resolves to is still stamped so reporting can join on it.
    const node = await asA(() => nodes.create({ fiscalYearId: fyAId, code: 'N-5000', name: 'Utilities' }));
    await expect(
      asA(() => budgets.create({ fiscalYearId: fyAId, departmentId: deptAId, nodeId: node.id, glAccount: 'NOPE', amountTotal: '1000' })),
    ).rejects.toThrow(/Unknown GL account 'NOPE'/);

    const created = await asA(() => budgets.create({ fiscalYearId: fyAId, departmentId: deptAId, nodeId: node.id, glAccount: '5000', amountTotal: '1000' }));
    const reread = await orm.em.fork().findOneOrFail(Budget, { id: created.id }, { ...FILTER_OFF, populate: ['account', 'node'] });
    expect(reread.glAccount).toBe('5000');
    expect(reread.account?.code).toBe('5000');
    expect(reread.node.code).toBe('N-5000');
  });

  it('budget-create accepts no GL account at all', async () => {
    // A budget whose spending posts to several accounts names none: naming one of them would be
    // false. This is the case the old `(fiscal year, department, gl_account)` key could not hold.
    const node = await asA(() => nodes.create({ fiscalYearId: fyAId, code: 'N-MULTI', name: 'Vehicle instalments' }));
    const created = await asA(() =>
      budgets.create({ fiscalYearId: fyAId, departmentId: deptAId, nodeId: node.id, amountTotal: '1000' }),
    );
    const reread = await orm.em.fork().findOneOrFail(Budget, { id: created.id }, { ...FILTER_OFF, populate: ['account'] });
    expect(reread.glAccount ?? null).toBeNull();
    expect(reread.account).toBeNull();
  });
});
