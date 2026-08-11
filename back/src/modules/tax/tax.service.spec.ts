import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType, AccountType, TaxKind } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { Currency } from '../currency/currency.entities';
import { AccountRole, JournalEntry, JournalLine } from '../gl/gl.entities';
import { Company } from '../multi-company/multi-company.entities';
import { TaxService } from './tax.service';
import type { MikroORM } from '@mikro-orm/postgresql';

describe('TaxService.computeLineVat (pure)', () => {
  it('rounds line VAT to the currency decimal places', () => {
    expect(TaxService.computeLineVat('1000', '0.07', 2)).toBe('70.00');
    expect(TaxService.computeLineVat('333.33', '0.07', 2)).toBe('23.33'); // 23.3331 → 23.33
    expect(TaxService.computeLineVat('1000', '0.07', 0)).toBe('70');
  });

  it('document tax_total is the sum of rounded per-line amounts (no drift)', () => {
    const lines = ['33.33', '66.67', '100.00'];
    const perLine = lines.map((n) => TaxService.computeLineVat(n, '0.07', 2));
    const taxTotal = perLine.reduce((s, t) => (Number(s) + Number(t)).toFixed(2), '0.00');
    // Σ rounded lines, not a single round of the whole — this is what the submit flow stamps.
    expect(perLine).toEqual(['2.33', '4.67', '7.00']);
    expect(taxTotal).toBe('14.00');
  });

  it('computeWht rounds the withheld amount on the net base', () => {
    expect(TaxService.computeWht('100000', '0.03', 2)).toBe('3000.00');
    expect(TaxService.computeWht('1234.56', '0.05', 2)).toBe('61.73'); // 61.728 → 61.73
  });
});

const hasDb = await dbAvailable();

describe.skipIf(!hasDb)('TaxService CRUD (DB-backed)', () => {
  let orm: MikroORM;
  let tax: TaxService;
  let companyA = '';
  let companyB = '';

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    tax = new TaxService(orm.em, new CompanyScopeService(orm.em));
    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    await em.flush();
    companyA = a.id; companyB = b.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyB, grants: [] }, fn);

  it('enforces per-company code uniqueness and isolation', async () => {
    await asA(() => tax.create({ code: 'VAT7', name: 'VAT 7%', kind: TaxKind.VAT, rate: '0.07' }));
    await expect(asA(() => tax.create({ code: 'VAT7', name: 'dup', kind: TaxKind.VAT, rate: '0.07' }))).rejects.toThrow(/already exists/);
    // Same code in another company is fine, and A cannot see B's codes.
    await asB(() => tax.create({ code: 'VAT7', name: 'B VAT', kind: TaxKind.VAT, rate: '0.10' }));
    const listA = await asA(() => tax.list({ limit: 100 }, true));
    expect(listA.items.every((t) => t.company.id === companyA)).toBe(true);
    expect(listA.items).toHaveLength(1);
  });

  it('lists only active VAT codes as selectable', async () => {
    await asA(() => tax.create({ code: 'VAT0', name: 'Zero-rated', kind: TaxKind.VAT, rate: '0', isActive: false }));
    const sel = await asA(() => tax.listSelectableVat());
    expect(sel.some((t) => t.code === 'VAT7')).toBe(true);
    expect(sel.some((t) => t.code === 'VAT0')).toBe(false); // inactive excluded
  });
});

/**
 * The figure a company files its monthly return on.
 *
 * Read from the ledger rather than from `document.base_tax_total` / `payment.wht_amount`, so it
 * cannot disagree with the books. Entries are written directly here, with the `entry_date` each
 * case needs — `createEntry` would resolve the date itself, which is precisely the behaviour under
 * test in the timezone case.
 */
describe.skipIf(!hasDb)('TaxService.vatSummary (DB-backed)', () => {
  let orm: MikroORM;
  let tax: TaxService;
  let companyA = '';
  let companyB = '';
  let vatA: Account;
  let whtA: Account;
  let vatB: Account;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    tax = new TaxService(orm.em, new CompanyScopeService(orm.em));

    const em = orm.em.fork();
    const thb = em.create(Currency, { code: 'THB', name: 'Baht', decimalPlaces: 2, isActive: true });
    const a = em.create(Company, { code: 'A', nameTh: 'A', taxId: '1', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    const b = em.create(Company, { code: 'B', nameTh: 'B', taxId: '2', branchCode: '00000', baseCurrency: thb, isActive: true, createdAt: new Date() });
    await em.flush();
    companyA = a.id;
    companyB = b.id;

    const account = (company: Company, code: string, name: string, type: AccountType) =>
      em.create(Account, { company, code, name, accountType: type, isPostable: true, isActive: true } as never);
    vatA = account(a, '1300', 'Input VAT', AccountType.ASSET);
    whtA = account(a, '2100', 'WHT Payable', AccountType.LIABILITY);
    const expenseA = account(a, '5000', 'Expense', AccountType.EXPENSE);
    vatB = account(b, '1300', 'Input VAT', AccountType.ASSET);
    await em.flush();

    em.create(AccountRole, { company: a, role: AccountRoleType.VAT_INPUT, account: vatA } as never);
    em.create(AccountRole, { company: a, role: AccountRoleType.WHT_PAYABLE, account: whtA } as never);
    em.create(AccountRole, { company: b, role: AccountRoleType.VAT_INPUT, account: vatB } as never);
    await em.flush();
    // Referenced so the fixture's intent is explicit: A has an expense account these entries
    // balance against.
    expect(expenseA.id).toBeTruthy();
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyB, grants: [] }, fn);

  /**
   * One line on one account, dated on a company-day. The counter-side is irrelevant here.
   *
   * `createdAt` is settable so a case can put the row's TIMESTAMP in a different month from its
   * company-day — the discriminator between reading `entry_date` and reading any instant.
   */
  const post = async (
    companyId: string,
    entryDate: string,
    account: Account,
    debit: string,
    credit: string,
    createdAt = new Date(`${entryDate}T12:00:00Z`),
  ) => {
    const em = orm.em.fork();
    const company = em.getReference(Company, companyId);
    const entry = em.create(JournalEntry, {
      company,
      entryDate,
      sourceType: 'MANUAL_JV',
      sourceId: randomUUID(),
      memo: 'fixture',
      createdAt,
    } as never);
    em.create(JournalLine, {
      company,
      journalEntry: entry,
      account: em.getReference(Account, account.id),
      debit,
      credit,
    } as never);
    await em.flush();
  };

  const clear = async () => {
    const em = orm.em.fork();
    await em.nativeDelete(JournalLine, {}, { filters: { company: false } });
    await em.nativeDelete(JournalEntry, {}, { filters: { company: false } });
  };

  const rowFor = (rows: Array<{ period: string; vat: string; wht: string }>, period: string) =>
    rows.find((r) => r.period === period);

  it('reports input VAT in the month of the entry date', async () => {
    await clear();
    await post(companyA, '2026-07-15', vatA, '7000.00', '0');
    const rows = await asA(() => tax.vatSummary());
    expect(Number(rowFor(rows, '2026-07')?.vat)).toBe(7000);
  });

  it('reports the company-day month, not the month of any timestamp', async () => {
    // The bug this change removes: the old implementation binned
    // `(paidAt ?? createdAt).toISOString().slice(0, 7)`, so everything in the first hours of a month
    // at a positive UTC offset was filed in the month before.
    //
    // The company-day is 1 August; the row's timestamp is 31 July in UTC — exactly the seven-hour
    // window that used to be misfiled. Any implementation that reaches for an instant reports July
    // and fails here; reading `entry_date` reports August, because there is no instant to convert.
    await clear();
    await post(companyA, '2026-08-01', vatA, '500.00', '0', new Date('2026-07-31T17:30:00Z'));
    const rows = await asA(() => tax.vatSummary());
    expect(Number(rowFor(rows, '2026-08')?.vat)).toBe(500);
    expect(rowFor(rows, '2026-07')).toBeUndefined();
  });

  it('reports a month of withholding as a positive figure', async () => {
    // WHT_PAYABLE is a liability and is CREDITED. Taken as debit − credit it would read −3000,
    // which is the kind of sign error a balanced entry hides.
    await clear();
    await post(companyA, '2026-07-20', whtA, '0', '3000.00');
    const rows = await asA(() => tax.vatSummary());
    expect(Number(rowFor(rows, '2026-07')?.wht)).toBe(3000);
  });

  it('lets a reversal reduce the period it is dated in, not the period it reverses', async () => {
    await clear();
    await post(companyA, '2026-07-10', vatA, '1000.00', '0');
    await post(companyA, '2026-08-05', vatA, '0', '1000.00'); // the reversing side
    const rows = await asA(() => tax.vatSummary());
    expect(Number(rowFor(rows, '2026-07')?.vat)).toBe(1000);
    expect(Number(rowFor(rows, '2026-08')?.vat)).toBe(-1000);
  });

  it('keeps one company out of another company summary', async () => {
    await clear();
    await post(companyA, '2026-09-01', vatA, '100.00', '0');
    await post(companyB, '2026-09-01', vatB, '999.00', '0');
    expect(Number(rowFor(await asA(() => tax.vatSummary()), '2026-09')?.vat)).toBe(100);
    expect(Number(rowFor(await asB(() => tax.vatSummary()), '2026-09')?.vat)).toBe(999);
  });

  it('reports zero rather than failing when a role is unmapped', async () => {
    // Company B has VAT_INPUT mapped but never mapped WHT_PAYABLE — it has never withheld anything,
    // and the honest answer is nothing, not a 500 on a screen that also shows VAT.
    await clear();
    await post(companyB, '2026-10-01', vatB, '50.00', '0');
    const rows = await asB(() => tax.vatSummary());
    expect(Number(rowFor(rows, '2026-10')?.vat)).toBe(50);
    expect(Number(rowFor(rows, '2026-10')?.wht)).toBe(0);
  });

  it('equals the account net movement it claims to report', async () => {
    // The property, asserted against the ledger rather than against a restatement of the code.
    await clear();
    await post(companyA, '2026-11-03', vatA, '210.00', '0');
    await post(companyA, '2026-11-09', vatA, '90.00', '0');
    await post(companyA, '2026-11-20', vatA, '0', '30.00');

    const em = orm.em.fork();
    const lines = await em.find(JournalLine, { account: vatA.id }, { filters: { company: false } });
    const net = lines.reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0);

    const rows = await asA(() => tax.vatSummary());
    expect(Number(rowFor(rows, '2026-11')?.vat)).toBe(net);
    expect(net).toBe(270);
  });
});
