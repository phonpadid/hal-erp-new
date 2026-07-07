import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { Currency } from '../currency/currency.entities';
import { Company } from '../multi-company/multi-company.entities';
import { FinancialReportsService } from './financial-reports.service';
import { JournalEntry, JournalLine } from './gl.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('financial reports (DB-backed)', () => {
  let orm: MikroORM;
  let reports: FinancialReportsService;
  let companyId = '';
  const acc: Record<string, string> = {}; // code → id

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    reports = new FinancialReportsService(new CompanyScopeService(orm.em));

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const co = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const chart: Array<[string, string, AccountType]> = [
      ['1000', 'Cash', AccountType.ASSET],
      ['2100', 'WHT Payable', AccountType.LIABILITY],
      ['3000', 'Equity', AccountType.EQUITY],
      ['4000', 'Revenue', AccountType.REVENUE],
      ['5000', 'Expense', AccountType.EXPENSE],
    ];
    for (const [code, name, accountType] of chart) {
      const a = em.create(Account, { company: co, code, name, accountType, isPostable: true, isActive: true });
      acc[code] = a.id;
    }
    await em.flush();
    companyId = co.id;

    // Entry A (2026-07-01): Dr Expense 100000 / Cr Cash 100000.
    const eA = em.create(JournalEntry, { company: co, entryDate: '2026-07-01', sourceType: 'PAYMENT', sourceId: '00000000-0000-4000-8000-00000000000a', createdAt: new Date() });
    em.create(JournalLine, { company: co, journalEntry: eA, account: em.getReference(Account, acc['5000']), debit: '100000.00', credit: '0.00' });
    em.create(JournalLine, { company: co, journalEntry: eA, account: em.getReference(Account, acc['1000']), debit: '0.00', credit: '100000.00' });
    // Entry B (2026-07-02): Dr Cash 204000 / Cr Revenue 200000 / Cr WHT Payable 4000.
    const eB = em.create(JournalEntry, { company: co, entryDate: '2026-07-02', sourceType: 'PAYMENT', sourceId: '00000000-0000-4000-8000-00000000000b', createdAt: new Date() });
    em.create(JournalLine, { company: co, journalEntry: eB, account: em.getReference(Account, acc['1000']), debit: '204000.00', credit: '0.00' });
    em.create(JournalLine, { company: co, journalEntry: eB, account: em.getReference(Account, acc['4000']), debit: '0.00', credit: '200000.00' });
    em.create(JournalLine, { company: co, journalEntry: eB, account: em.getReference(Account, acc['2100']), debit: '0.00', credit: '4000.00' });
    await em.flush();
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId, grants: [] }, fn);
  const bal = (rows: Array<{ code: string; balance?: string; amount?: string }>, code: string) =>
    Number(rows.find((r) => r.code === code)?.balance ?? rows.find((r) => r.code === code)?.amount ?? 0);

  it('trial balance: total debits equal total credits, accounts on their normal side', async () => {
    const tb = await asA(() => reports.trialBalance());
    expect(Number(tb.totalDebit)).toBe(304000); // 100000 + 204000
    expect(Number(tb.totalCredit)).toBe(304000); // 100000 + 200000 + 4000
    expect(tb.balanced).toBe(true);
    expect(bal(tb.accounts, '1000')).toBe(104000); // ASSET debit-normal
    expect(bal(tb.accounts, '4000')).toBe(200000); // REVENUE credit-normal (positive)
    expect(bal(tb.accounts, '2100')).toBe(4000); // LIABILITY credit-normal
  });

  it('income statement: net income = revenue − expense', async () => {
    const is = await asA(() => reports.incomeStatement());
    expect(Number(is.revenueTotal)).toBe(200000);
    expect(Number(is.expenseTotal)).toBe(100000);
    expect(Number(is.netIncome)).toBe(100000);
  });

  it('balance sheet: assets = liabilities + equity + derived retained earnings', async () => {
    const bs = await asA(() => reports.balanceSheet());
    expect(Number(bs.assetsTotal)).toBe(104000);
    expect(Number(bs.liabilitiesTotal)).toBe(4000);
    expect(Number(bs.equityTotal)).toBe(0);
    expect(Number(bs.retainedEarnings)).toBe(100000); // cumulative net income
    expect(Number(bs.liabilitiesEquityTotal)).toBe(104000);
    expect(bs.balanced).toBe(true);
  });

  it('account ledger: lines in date order with a running balance', async () => {
    const led = await asA(() => reports.accountLedger(acc['1000']));
    expect(led.lines.map((l) => Number(l.runningBalance))).toEqual([-100000, 104000]);
    expect(led.account?.code).toBe('1000');
    expect(Number(led.balance)).toBe(104000);
  });

  it('is company-scoped — another company sees nothing', async () => {
    const other = '11111111-1111-4111-8111-111111111111';
    const tb = await RequestContext.run({ companyId: other, grants: [] }, () => reports.trialBalance());
    expect(tb.accounts).toHaveLength(0);
    expect(Number(tb.totalDebit)).toBe(0);
  });
});
