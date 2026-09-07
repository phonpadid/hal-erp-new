import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntityManager } from '@mikro-orm/postgresql';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType, AccountType, DocStatus } from '../../common/enums';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Account } from '../accounting/accounting.entities';
import { Workflow } from '../approval/approval.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { AccountRoleService } from '../gl/account-role.service';
import { AccountRole, JournalEntry, JournalLine } from '../gl/gl.entities';
import { SOURCE_BANK_CLEARED } from '../gl/gl-posting.service';
import { Company, Department } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { BankAccount } from './bank-account.entities';
import { BankAccountService } from './bank-account.service';
import { Payment } from './payment.entities';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The second half of a payment.
 *
 * Recording one credits the clearing account; the bank confirming it moves the money to the account
 * it actually left. The clearing balance is then the payments in flight — the reconciling item,
 * falling out of the structure rather than needing a statement import.
 */
describe.skipIf(!hasDb)('bank reconciliation (DB-backed)', () => {
  let orm: MikroORM;
  let banks: BankAccountService;
  let companyId = '';
  let userId = '';
  let bankAccountId = '';
  let seq = 0;

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId, departmentId: 'd', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    banks = new BankAccountService(
      orm.em as EntityManager,
      scope,
      new AccountRoleService(orm.em),
      new PeriodGuardService(),
    );

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;

    // `1000 Cash` is the BANK's account now; `1010 Cash Clearing` is where a payment waits.
    const cash = await em.findOneOrFail(Account, { company: companyId, code: '1000' }, FILTER_OFF);
    const account = await asCompany(() =>
      banks.create({
        name: 'Main', bankName: 'BCEL', accountNo: '010-1',
        currencyCode: 'THB', glAccountId: cash.id,
      }),
    );
    bankAccountId = account.id;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  /**
   * A recorded payment, optionally naming the bank account it left from.
   *
   * Writes the CREDIT to the clearing account that the payment path writes, so the two-entry
   * relationship this file is about actually exists in the fixture. Without it the clearing account
   * would only ever be debited and "outstanding equals the clearing balance" could not be asserted
   * at all — which is how the first version of that case got a nonsense answer.
   */
  async function paid(
    amount: string,
    withBank = true,
    whtAmount = '0',
    transferFrom?: 'PRIMARY' | 'RESERVE',
  ): Promise<string> {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const type = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(
      DeptDocType, { department: dept.id, documentType: type.id },
      { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] },
    );
    const doc = em.create(Document, {
      docNo: `BNK-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: type, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId), status: DocStatus.COMPLETED,
      baseTotalAmount: amount, createdAt: new Date(),
    } as never);
    await em.flush();
    const payment = em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: amount, baseActual: amount,
      fxDelta: '0.00', fxKind: 'NONE', whtAmount,
      bankAccount: withBank ? em.getReference(BankAccount, bankAccountId) : undefined,
      transferFrom,
      paidAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();

    const role = await em.findOneOrFail(
      AccountRole, { company: companyId, role: AccountRoleType.CASH_CLEARING },
      { ...FILTER_OFF, populate: ['account'] },
    );
    const expense = await em.findOneOrFail(Account, { company: companyId, code: '5000' }, FILTER_OFF);
    const net = Money.subtract(amount, whtAmount);
    const entry = em.create(JournalEntry, {
      company: em.getReference(Company, companyId), entryDate: '2026-05-01',
      sourceType: 'PAYMENT', sourceId: doc.id, memo: 'payment fixture', createdAt: new Date(),
    } as never);
    em.create(JournalLine, {
      company: em.getReference(Company, companyId), journalEntry: entry,
      account: expense, debit: net, credit: '0',
    } as never);
    em.create(JournalLine, {
      company: em.getReference(Company, companyId), journalEntry: entry,
      account: role.account, debit: '0', credit: net,
    } as never);
    await em.flush();
    return payment.id;
  }

  const clearingBalance = async () => {
    const em = orm.em.fork();
    const role = await em.findOneOrFail(
      AccountRole, { company: companyId, role: AccountRoleType.CASH_CLEARING },
      { ...FILTER_OFF, populate: ['account'] },
    );
    const lines = await em.find(JournalLine, { account: role.account.id }, FILTER_OFF);
    return lines.reduce((t, l) => Money.add(t, Money.subtract(l.debit, l.credit)), '0');
  };

  it('names a GL account rather than being one, and refuses another company account', async () => {
    const em = orm.em.fork();
    const base = await em.findOneOrFail(Company, { id: companyId }, FILTER_OFF);
    const other = em.create(Company, {
      code: 'BNKO', nameTh: 'Other', taxId: '6', branchCode: '00000',
      baseCurrency: base.baseCurrency, isActive: true, createdAt: new Date(),
    } as never);
    await em.flush();
    const foreignAccount = em.create(Account, {
      company: other, code: '1000', name: 'Their cash',
      accountType: AccountType.ASSET, isPostable: true, isActive: true,
    } as never);
    await em.flush();

    await expect(
      asCompany(() => banks.create({
        name: 'Bad', bankName: 'X', accountNo: '999',
        currencyCode: 'THB', glAccountId: foreignAccount.id,
      })),
    ).rejects.toThrow(/not found/i);
  });

  it('moves a confirmed payment out of the clearing account, on the BANK date', async () => {
    const paymentId = await paid('100000.00');
    const entry = await asCompany(() => banks.confirmCleared(paymentId, '2026-05-20'));

    expect(entry.entryDate).toBe('2026-05-20');
    const em = orm.em.fork();
    const lines = await em.find(
      JournalLine, { journalEntry: entry.id }, { ...FILTER_OFF, populate: ['account'] },
    );
    // Dr clearing, Cr the bank account's GL account. Balanced, and for what actually left.
    expect(Number(lines.find((l) => l.account.code === '1010')?.debit)).toBe(100000);
    expect(Number(lines.find((l) => l.account.code === '1000')?.credit)).toBe(100000);
  });

  it('clears the amount that actually left, net of withholding', async () => {
    // The payment credited the clearing account net of WHT; confirming must move the same figure,
    // or the clearing account would never reach zero.
    const paymentId = await paid('50000.00', true, '1500.00');
    const entry = await asCompany(() => banks.confirmCleared(paymentId, '2026-05-21'));
    const em = orm.em.fork();
    const lines = await em.find(
      JournalLine, { journalEntry: entry.id }, { ...FILTER_OFF, populate: ['account'] },
    );
    expect(Number(lines.find((l) => l.account.code === '1010')?.debit)).toBe(48500);
  });

  it('confirms a payment once', async () => {
    const paymentId = await paid('7000.00');
    await asCompany(() => banks.confirmCleared(paymentId, '2026-05-22'));
    await asCompany(() => banks.confirmCleared(paymentId, '2026-05-23'));

    const entries = await orm.em.fork().find(
      JournalEntry, { sourceType: SOURCE_BANK_CLEARED, sourceId: paymentId }, FILTER_OFF,
    );
    expect(entries).toHaveLength(1);
    // The second call resolved to the first entry rather than re-dating it.
    expect(entries[0].entryDate).toBe('2026-05-22');
  });

  it('refuses a payment that names no bank account', async () => {
    // There is no account to credit — and a guessed one would be a fact about money nobody
    // established.
    const paymentId = await paid('3000.00', false);
    await expect(asCompany(() => banks.confirmCleared(paymentId, '2026-05-24'))).rejects.toThrow(
      /no bank account/i,
    );
  });

  it('lists what has not cleared, and drops it once confirmed', async () => {
    const paymentId = await paid('9000.00');
    const before = await asCompany(() => banks.outstanding(bankAccountId));
    expect(before.items.map((i) => i.paymentId)).toContain(paymentId);

    await asCompany(() => banks.confirmCleared(paymentId, '2026-05-25'));
    const after = await asCompany(() => banks.outstanding(bankAccountId));
    expect(after.items.map((i) => i.paymentId)).not.toContain(paymentId);
    expect(Number(after.total)).toBe(Number(before.total) - 9000);
  });

  it('reports payments that name no bank account, so the clearing account can reconcile', async () => {
    // A payment with no bank account still credits the clearing account, and belongs to no bank
    // account's reconciliation. Every payment recorded before bank accounts existed is in this
    // state — without this read the clearing balance could never be explained.
    const orphan = await paid('3300.00', false);
    const { items, total } = await asCompany(() => banks.unattributed());
    expect(items.map((i) => i.paymentId)).toContain(orphan);
    expect(Number(total)).toBeGreaterThanOrEqual(3300);
  });

  it('still reports a payment that only says main or reserve as unattributed', async () => {
    // "The reserve one" is a claim by a person, not a link to a configured `bank_account`. The
    // clearing balance still carries the payment and no account's reconciliation does, so it belongs
    // on this list — the text is the lead whoever attributes it works from, not the attribution.
    const stated = await paid('4400.00', false, '0', 'RESERVE');
    const { items } = await asCompany(() => banks.unattributed());
    const row = items.find((i) => i.paymentId === stated);
    expect(row).toBeDefined();
    expect(row?.transferFrom).toBe('RESERVE');
  });

  it('accounts for the whole clearing balance across the two reads', async () => {
    // The property the reconciliation rests on: what is outstanding per bank account PLUS what is
    // unattributed is the clearing balance. The first version of this case asserted the per-account
    // total alone and was 3,000 out — the payment naming no bank account, invisible to it. That gap
    // is what `unattributed` exists to close.
    await paid('12345.00');
    const perAccount = await asCompany(() => banks.outstanding(bankAccountId));
    const orphans = await asCompany(() => banks.unattributed());

    const explained = Money.add(perAccount.total, orphans.total);
    // Clearing carries credits from payments and debits from confirmations, so its balance is the
    // negative of what is still in flight.
    expect(Number(await clearingBalance())).toBeCloseTo(-Number(explained), 2);
  });
});
