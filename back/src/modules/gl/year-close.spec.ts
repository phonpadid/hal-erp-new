import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AccountingPeriodStatus, AccountType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { AccountService } from '../accounting/account.service';
import { AccountingPeriod, AccountingPeriodLog } from '../accounting/period/accounting-period.entities';
import { AccountingPeriodService } from '../accounting/period/accounting-period.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Company, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { FinancialReportsService } from './financial-reports.service';
import { createEntry, SOURCE_MANUAL, SOURCE_YEAR_CLOSE } from './gl-posting.service';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';
import { JournalService } from './journal.service';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { FxRevaluationService } from './fx-revaluation.service';
import { ReceivedNotInvoicedService } from './received-not-invoiced.service';
import { YearCloseService } from './year-close.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Rolling a year's result into equity.
 *
 * Without it, revenue and expense accumulate forever and the balance sheet's equity is a derivation
 * rather than a balance. The entry is dated the year's last day — inside the period being closed —
 * which is why it is posted while that period is still open.
 */
describe.skipIf(!hasDb)('year-end close (DB-backed)', () => {
  let orm: MikroORM;
  let periods: AccountingPeriodService;
  let reports: FinancialReportsService;
  let guard: PeriodGuardService;
  let companyId = '';
  let fiscalYearId = '';
  let userId = '';
  let checkerId = '';
  let year = 0;
  let revenueCode = '';
  let expenseCode = '';
  let cashCode = '';
  let retainedCode = '';

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId, departmentId: 'd', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    guard = new PeriodGuardService();
    reports = new FinancialReportsService(scope);
    periods = new AccountingPeriodService(
      scope,
      new JournalService(scope),
      new ReceivedNotInvoicedService(orm.em),
      new FxRevaluationService(orm.em, new ExchangeRateService(orm.em)),
      new AccountRoleService(orm.em),
      guard,
      new YearCloseService(new AccountRoleService(orm.em), guard),
    );

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    const fy = await em.findOneOrFail(FiscalYear, { company: companyId }, FILTER_OFF);
    fiscalYearId = fy.id;
    year = fy.year;
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
    checkerId = (await em.findOneOrFail(AppUser, { username: { $ne: 'requester' } }, { ...FILTER_OFF, orderBy: { username: 'ASC' } })).id;

    // Reuse the seeded revenue account rather than minting one: `(company, code)` is unique, and a
    // fixture that duplicates a seeded code tests the fixture.
    const rev = await em.findOneOrFail(
      Account,
      { company: companyId, accountType: AccountType.REVENUE, isPostable: true },
      { ...FILTER_OFF, orderBy: { code: 'ASC' } },
    );
    revenueCode = rev.code;
    expenseCode = '5000';
    cashCode = '1000';
    retainedCode = (await em.findOneOrFail(
      AccountRole, { company: companyId, role: 'RETAINED_EARNINGS' }, { ...FILTER_OFF, populate: ['account'] },
    )).account.code;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const d = (mm: number, dd: number) => `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  /**
   * Something that earns or spends inside the year.
   *
   * Written through `createEntry`, the constructor every entry in the system passes through, so the
   * fixture obeys balance, the company's calendar day and the period guard exactly as production
   * does. It used to go through the voucher service, which now raises a DOCUMENT and routes it
   * through a workflow — an approval chain is a great deal of apparatus for a file whose subject is
   * what happens when a year closes, and routing a fixture through it would test the router.
   */
  const post = async (debitCode: string, creditCode: string, amount: string, on: string) => {
    const em = orm.em.fork();
    const company = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    const account = (code: string) =>
      em.findOneOrFail(Account, { company: companyId, code }, FILTER_OFF);
    // Wrapped like every production caller: `createEntry` persists into the caller's unit of work
    // and the commit is what makes the entry real.
    const debit = await account(debitCode);
    const credit = await account(creditCode);
    return em.transactional((tem) => createEntry(
      tem,
      {
        company,
        instant: new Date(`${on}T12:00:00Z`),
        sourceType: SOURCE_MANUAL,
        sourceId: randomUUID(),
        memo: 'activity',
        createdById: userId,
        lines: [
          { account: debit, debit: amount, credit: '0' },
          { account: credit, debit: '0', credit: amount },
        ],
      },
      guard,
    ));
  };

  const declare = (code: string, start: string, end: string) =>
    asCompany(() => periods.declare({ fiscalYearId, code, periodStart: start, periodEnd: end }));

  const closingEntry = () =>
    orm.em.fork().findOne(JournalEntry, { sourceType: SOURCE_YEAR_CLOSE, sourceId: fiscalYearId }, FILTER_OFF);
  const linesOf = (entryId: string) =>
    orm.em.fork().find(JournalLine, { journalEntry: entryId }, { ...FILTER_OFF, populate: ['account'] });
  const side = (lines: JournalLine[], code: string, s: 'debit' | 'credit') =>
    lines.filter((l) => l.account.code === code).reduce((t, l) => t + Number(l[s]), 0);

  const reset = async () => {
    const em = orm.em.fork();
    await em.nativeDelete(AccountingPeriodLog, {});
    await em.nativeDelete(AccountingPeriod, { company: companyId }, FILTER_OFF);
    await em.nativeDelete(JournalLine, {}, FILTER_OFF);
    await em.nativeDelete(JournalEntry, {}, FILTER_OFF);
    const fy = await em.findOneOrFail(FiscalYear, { id: fiscalYearId }, FILTER_OFF);
    fy.status = 'OPEN';
    await em.flush();
  };

  /**
   * Declare and close every month up to `upTo`, skipping any already handled — periods close in
   * order, so reaching December means walking there.
   */
  const closeThrough = async (upTo: number) => {
    const lastDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let mm = 1; mm <= upTo; mm += 1) {
      const em = orm.em.fork();
      const existing = await em.findOne(AccountingPeriod, { company: companyId, code: `Y-${mm}` }, FILTER_OFF);
      const p = existing ?? (await declare(`Y-${mm}`, d(mm, 1), d(mm, lastDay[mm - 1])));
      if (p.status !== AccountingPeriodStatus.CLOSED) await asCompany(() => periods.close(p.id));
    }
  };

  it('closes the year when its final period closes, and not before', async () => {
    await reset();
    await post(cashCode, revenueCode, '500000.00', d(3, 15));
    await post(expenseCode, cashCode, '300000.00', d(4, 10));

    await closeThrough(11);
    // Eleven months closed and the year is untouched: only the LAST period ends it.
    expect(await closingEntry()).toBeNull();
    expect((await orm.em.fork().findOneOrFail(FiscalYear, { id: fiscalYearId }, FILTER_OFF)).status).toBe('OPEN');

    await closeThrough(12);
    const entry = await closingEntry();
    expect(entry?.entryDate).toBe(d(12, 31));
    expect((await orm.em.fork().findOneOrFail(FiscalYear, { id: fiscalYearId }, FILTER_OFF)).status).toBe('CLOSED');

    // A profit: revenue debited, expense credited, the difference to retained earnings.
    const lines = await linesOf(entry!.id);
    expect(side(lines, revenueCode, 'debit')).toBe(500000);
    expect(side(lines, expenseCode, 'credit')).toBe(300000);
    expect(side(lines, retainedCode, 'credit')).toBe(200000);
  });

  it('debits retained earnings for a loss', async () => {
    // Asserted separately: a sign error here is invisible in an entry that still balances.
    await reset();
    await post(cashCode, revenueCode, '100000.00', d(2, 1));
    await post(expenseCode, cashCode, '180000.00', d(2, 2));
    await closeThrough(12);

    const lines = await linesOf((await closingEntry())!.id);
    expect(side(lines, retainedCode, 'debit')).toBe(80000);
    expect(side(lines, retainedCode, 'credit')).toBe(0);
  });

  it('closes a year with no activity without writing an entry', async () => {
    await reset();
    await closeThrough(12);

    expect(await closingEntry()).toBeNull();
    expect((await orm.em.fork().findOneOrFail(FiscalYear, { id: fiscalYearId }, FILTER_OFF)).status).toBe('CLOSED');
  });

  it('leaves revenue and expense at zero for the closed year', async () => {
    // The property the whole entry exists to create.
    await reset();
    await post(cashCode, revenueCode, '90000.00', d(5, 5));
    await post(expenseCode, cashCode, '40000.00', d(6, 6));
    await closeThrough(12);

    const em = orm.em.fork();
    const lines = await em.find(
      JournalLine,
      { journalEntry: { entryDate: { $gte: d(1, 1), $lte: d(12, 31) } } },
      { ...FILTER_OFF, populate: ['account'] },
    );
    for (const code of [revenueCode, expenseCode]) {
      const net = lines
        .filter((l) => l.account.code === code)
        .reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0);
      expect(net).toBe(0);
    }
  });

  it('closes the year once, even after a reopen and re-close', async () => {
    await reset();
    await post(cashCode, revenueCode, '10000.00', d(7, 7));
    await closeThrough(12);
    const last = await orm.em.fork().findOneOrFail(AccountingPeriod, { company: companyId, code: 'Y-12' }, FILTER_OFF);
    await asCompany(() => periods.reopen(last.id, 'a late adjustment'));
    await asCompany(() => periods.close(last.id));

    const entries = await orm.em.fork().find(JournalEntry, { sourceType: SOURCE_YEAR_CLOSE, sourceId: fiscalYearId }, FILTER_OFF);
    expect(entries).toHaveLength(1);
  });

  it('refuses the close when RETAINED_EARNINGS is unmapped, leaving both period and year', async () => {
    // A half-applied close is the failure this ordering exists to avoid.
    await reset();
    await post(cashCode, revenueCode, '20000.00', d(8, 8));
    await closeThrough(11);

    const em = orm.em.fork();
    await em.nativeDelete(AccountRole, { company: companyId, role: 'RETAINED_EARNINGS' }, FILTER_OFF);
    const dec = await declare('Y-12', d(12, 1), d(12, 31));
    await expect(asCompany(() => periods.close(dec.id))).rejects.toThrow(/RETAINED_EARNINGS/);

    const fresh = orm.em.fork();
    expect((await fresh.findOneOrFail(AccountingPeriod, { id: dec.id }, FILTER_OFF)).status).toBe('OPEN');
    expect((await fresh.findOneOrFail(FiscalYear, { id: fiscalYearId }, FILTER_OFF)).status).toBe('OPEN');

    const restore = orm.em.fork();
    const acct = await restore.findOneOrFail(Account, { company: companyId, code: retainedCode }, FILTER_OFF);
    restore.create(AccountRole, { company: restore.getReference(Company, companyId), role: 'RETAINED_EARNINGS', account: acct } as never);
    await restore.flush();
  });

  it('keeps the balance sheet balanced, with brought forward separate from the current period', async () => {
    await reset();
    await post(cashCode, revenueCode, '200000.00', d(3, 3));
    await closeThrough(12);

    const sheet = await asCompany(() => reports.balanceSheet(d(12, 31)));
    expect(sheet.balanced).toBe(true);
    // The closed year's result is a BALANCE in equity now…
    expect(Number(sheet.retainedEarningsBroughtForward)).toBe(200000);
    // …and the derived figure covers only what still stands, which after the close is nothing.
    expect(Number(sheet.retainedEarnings)).toBe(0);
  });
});
