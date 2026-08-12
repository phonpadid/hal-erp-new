import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType, AccountType } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { Account } from '../accounting/accounting.entities';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Currency } from '../currency/currency.entities';
import { AccountRoleService } from '../gl/account-role.service';
import { AccountRole, JournalEntry, JournalLine } from '../gl/gl.entities';
import { SOURCE_VAT_RETURN } from '../gl/gl-posting.service';
import { Company } from '../multi-company/multi-company.entities';
import { TaxService } from './tax.service';
import { VatReturn } from './vat-return.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Filing the return: input VAT stops being tax paid on purchases and becomes a debt the revenue
 * authority owes. Until this existed, `VAT_INPUT` was debited by every purchase and credited by
 * nothing, so the asset grew for the life of the system while the company was in fact reclaiming it
 * every month.
 */
describe.skipIf(!hasDb)('TaxService.fileVatReturn (DB-backed)', () => {
  let orm: MikroORM;
  let tax: TaxService;
  let companyA = '';
  let companyB = '';
  let vatA: Account;
  let receivableA: Account;
  let vatB: Account;
  let receivableB: Account;

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    tax = new TaxService(
      orm.em,
      new CompanyScopeService(orm.em),
      new AccountRoleService(orm.em),
      new PeriodGuardService(),
    );

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
    receivableA = account(a, '1320', 'VAT Receivable', AccountType.ASSET);
    vatB = account(b, '1300', 'Input VAT', AccountType.ASSET);
    receivableB = account(b, '1320', 'VAT Receivable', AccountType.ASSET);
    await em.flush();

    for (const [company, vat, receivable] of [[a, vatA, receivableA], [b, vatB, receivableB]] as const) {
      em.create(AccountRole, { company, role: AccountRoleType.VAT_INPUT, account: vat } as never);
      em.create(AccountRole, { company, role: AccountRoleType.VAT_RECEIVABLE, account: receivable } as never);
    }
    await em.flush();
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const asA = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyA, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) => RequestContext.run({ companyId: companyB, grants: [] }, fn);

  /** A purchase's input VAT, dated on a company-day. The counter-side is irrelevant here. */
  const postVat = async (companyId: string, entryDate: string, account: Account, debit: string, credit = '0') => {
    const em = orm.em.fork();
    const company = em.getReference(Company, companyId);
    const entry = em.create(JournalEntry, {
      company, entryDate, sourceType: 'MANUAL_JV', sourceId: randomUUID(), memo: 'fixture', createdAt: new Date(),
    } as never);
    em.create(JournalLine, {
      company, journalEntry: entry, account: em.getReference(Account, account.id), debit, credit,
    } as never);
    await em.flush();
  };

  const clear = async () => {
    const em = orm.em.fork();
    await em.nativeDelete(VatReturn, {}, FILTER_OFF);
    await em.nativeDelete(JournalLine, {}, FILTER_OFF);
    await em.nativeDelete(JournalEntry, {}, FILTER_OFF);
  };

  const entryFor = (returnId: string) =>
    orm.em.fork().findOne(
      JournalEntry,
      { sourceType: SOURCE_VAT_RETURN, sourceId: returnId },
      { ...FILTER_OFF, populate: ['lines', 'lines.account'] },
    );

  it('moves the period’s input VAT to the receivable', async () => {
    await clear();
    await postVat(companyA, '2026-07-05', vatA, '7000.00');
    await postVat(companyA, '2026-07-28', vatA, '3000.00');
    // Outside the period, so it must not be claimed by this return.
    await postVat(companyA, '2026-08-02', vatA, '500.00');

    const filed = await asA(() => tax.fileVatReturn({ periodFrom: '2026-07-01', periodTo: '2026-07-31' }));
    expect(Number(filed.inputVat)).toBe(10000);

    const entry = await entryFor(filed.id);
    const lines = entry!.lines.getItems();
    expect(lines).toHaveLength(2);
    const debit = lines.find((l) => Number(l.debit) > 0)!;
    const credit = lines.find((l) => Number(l.credit) > 0)!;
    expect(debit.account.id).toBe(receivableA.id);
    expect(credit.account.id).toBe(vatA.id);
    expect(Number(debit.debit)).toBe(10000);
    expect(Number(credit.credit)).toBe(10000);
    // Dated in the period it claims, not on the day the fixture happened to run.
    expect(entry!.entryDate).toBe('2026-07-31');
  });

  it('leaves the account holding only what has not been claimed', async () => {
    // The property the change exists for: after filing July, VAT_INPUT carries August alone.
    const em = orm.em.fork();
    const lines = await em.find(JournalLine, { account: vatA.id }, FILTER_OFF);
    const balance = lines.reduce((t, l) => t + Number(l.debit) - Number(l.credit), 0);
    expect(balance).toBe(500);
  });

  it('refuses a period that was already filed', async () => {
    await expect(
      asA(() => tax.fileVatReturn({ periodFrom: '2026-07-01', periodTo: '2026-07-31' })),
    ).rejects.toThrow(/already filed/i);
  });

  it('posts once when the same filing is retried', async () => {
    await clear();
    await postVat(companyA, '2026-09-10', vatA, '2100.00');
    const returnId = randomUUID();
    const first = await asA(() =>
      tax.fileVatReturn({ periodFrom: '2026-09-01', periodTo: '2026-09-30', returnId }),
    );
    // The retry is refused by the period key before it can post a second entry — the entry-level
    // idempotency behind it is asserted by there being exactly one entry for this id.
    await expect(
      asA(() => tax.fileVatReturn({ periodFrom: '2026-09-01', periodTo: '2026-09-30', returnId })),
    ).rejects.toThrow(/already filed/i);

    const em = orm.em.fork();
    const entries = await em.find(JournalEntry, { sourceType: SOURCE_VAT_RETURN }, FILTER_OFF);
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceId).toBe(first.id);
  });

  it('refuses a period with no input VAT', async () => {
    await clear();
    await expect(
      asA(() => tax.fileVatReturn({ periodFrom: '2026-11-01', periodTo: '2026-11-30' })),
    ).rejects.toThrow(/nothing to claim/i);
    const em = orm.em.fork();
    expect(await em.find(JournalEntry, { sourceType: SOURCE_VAT_RETURN }, FILTER_OFF)).toHaveLength(0);
  });

  it('claims only the filing company’s input VAT', async () => {
    // What carries the isolation is the ROLE lookup: it is company-scoped, so it resolves this
    // company's VAT_INPUT account and the movement is read from that account alone. Unscoping it
    // reddens every case here, which is the point — a return filed on another company's purchases
    // is not a smaller error than a wrong total.
    await clear();
    await postVat(companyA, '2026-10-05', vatA, '100.00');
    await postVat(companyB, '2026-10-05', vatB, '999.00');

    const a = await asA(() => tax.fileVatReturn({ periodFrom: '2026-10-01', periodTo: '2026-10-31' }));
    const b = await asB(() => tax.fileVatReturn({ periodFrom: '2026-10-01', periodTo: '2026-10-31' }));
    expect(Number(a.inputVat)).toBe(100);
    expect(Number(b.inputVat)).toBe(999);

    // And each company sees only its own filings.
    expect(await asA(() => tax.filedReturns())).toHaveLength(1);
    expect(await asB(() => tax.filedReturns())).toHaveLength(1);
  });
});
