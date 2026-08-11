import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RequestContext } from '../../common/context/request-context';
import { AccountingPeriodStatus, BudgetTxnType, DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountService } from '../accounting/account.service';
import { Account } from '../accounting/accounting.entities';
import { AccountingPeriod } from '../accounting/period/accounting-period.entities';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Workflow } from '../approval/approval.entities';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { GlPostingAttempt } from './gl-posting.entities';
import { GlPostingService, SOURCE_MANUAL, SOURCE_REVERSAL } from './gl-posting.service';
import { JournalEntry, JournalLine } from './gl.entities';
import { JournalVoucherService } from './journal-voucher.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The entry no event produces.
 *
 * Three changes in a row stopped at this wall: GRNI balances nobody could clear, documents approved
 * before accrual existed that nothing could restate, and the accrual and revaluation journals a
 * period close wants. All of them needed a person to be able to write the ledger.
 */
describe.skipIf(!hasDb)('journal voucher (DB-backed)', () => {
  let orm: MikroORM;
  let vouchers: JournalVoucherService;
  let posting: GlPostingService;
  let companyId = '';
  let budgetId = '';
  let userId = '';
  let year = 0;
  let expenseCode = '';
  let cashCode = '';
  let seq = 0;

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId, departmentId: 'd', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    const accounts = new AccountService(orm.em, scope);
    vouchers = new JournalVoucherService(scope, accounts, new PeriodGuardService());
    posting = new GlPostingService(orm.em, new AccountRoleService(orm.em), accounts, new PeriodGuardService());

    const em = orm.em.fork();
    companyId = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    year = (await em.findOneOrFail(FiscalYear, { company: companyId }, FILTER_OFF)).year;
    budgetId = (await em.findOneOrFail(Budget, { glAccount: '5000' }, FILTER_OFF)).id;
    userId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;
    expenseCode = '5000';
    cashCode = '1000';
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const d = (mm: number, dd: number) => `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  const voucher = (over: Record<string, unknown> = {}) =>
    ({
      entryDate: d(6, 15),
      memo: 'depreciation',
      lines: [
        { accountCode: expenseCode, debit: '5000.00', credit: '0' },
        { accountCode: cashCode, debit: '0', credit: '5000.00' },
      ],
      ...over,
    }) as never;

  const linesOf = (entryId: string) =>
    orm.em.fork().find(JournalLine, { journalEntry: entryId }, { ...FILTER_OFF, populate: ['account'] });

  it('posts a balanced voucher, attributed and marked manual', async () => {
    const entry = await asCompany(() => vouchers.post(voucher()));

    expect(entry.sourceType).toBe(SOURCE_MANUAL);
    expect(entry.entryDate).toBe(d(6, 15));
    // Attribution is one of the controls standing in for an approval route, so it is asserted
    // rather than assumed — the first draft claimed it and did not set it.
    expect(entry.createdBy?.id).toBe(userId);
    const lines = await linesOf(entry.id);
    expect(lines.find((l) => l.account.code === expenseCode)?.debit).toBe('5000.00');
    expect(lines.find((l) => l.account.code === cashCode)?.credit).toBe('5000.00');
  });

  it('refuses an unbalanced voucher and writes nothing', async () => {
    const before = await orm.em.fork().count(JournalEntry, {}, FILTER_OFF);
    await expect(
      asCompany(() => vouchers.post(voucher({
        lines: [
          { accountCode: expenseCode, debit: '100.00', credit: '0' },
          { accountCode: cashCode, debit: '0', credit: '99.00' },
        ],
      }))),
    ).rejects.toThrow(/Unbalanced/);
    expect(await orm.em.fork().count(JournalEntry, {}, FILTER_OFF)).toBe(before);
  });

  it('refuses a line that names an unusable account', async () => {
    // The resolver's rules, not a second copy of them here.
    await expect(
      asCompany(() => vouchers.post(voucher({
        lines: [
          { accountCode: 'NOPE', debit: '10.00', credit: '0' },
          { accountCode: cashCode, debit: '0', credit: '10.00' },
        ],
      }))),
    ).rejects.toThrow(/NOPE/);

    const em = orm.em.fork();
    const summary = em.create(Account, {
      company: em.getReference(Company, companyId), code: '5999', name: 'Summary node',
      accountType: 'EXPENSE', isPostable: false, isActive: true,
    } as never);
    await em.flush();
    await expect(
      asCompany(() => vouchers.post(voucher({
        lines: [
          { accountCode: '5999', debit: '10.00', credit: '0' },
          { accountCode: cashCode, debit: '0', credit: '10.00' },
        ],
      }))),
    ).rejects.toThrow(/not postable/);
    expect(summary.id).toBeTruthy();
  });

  it('refuses a line that is two-sided', async () => {
    await expect(
      asCompany(() => vouchers.post(voucher({
        lines: [
          { accountCode: expenseCode, debit: '10.00', credit: '10.00' },
          { accountCode: cashCode, debit: '0', credit: '10.00' },
        ],
      }))),
    ).rejects.toThrow(/exactly one non-zero side/);
  });

  it('refuses a voucher dated inside a closed period', async () => {
    // The case that proves a voucher is subject to the same ledger as an automatic posting, rather
    // than a way around it.
    const em = orm.em.fork();
    const fy = await em.findOneOrFail(FiscalYear, { company: companyId }, FILTER_OFF);
    em.create(AccountingPeriod, {
      company: em.getReference(Company, companyId), fiscalYear: fy, code: 'JV-FEB',
      periodStart: d(2, 1), periodEnd: d(2, 28), status: AccountingPeriodStatus.CLOSED,
      createdAt: new Date(),
    } as never);
    await em.flush();

    await expect(asCompany(() => vouchers.post(voucher({ entryDate: d(2, 10) })))).rejects.toThrow(/JV-FEB/);
    // …and an open month still works.
    const ok = await asCompany(() => vouchers.post(voucher({ entryDate: d(3, 10) })));
    expect(ok.entryDate).toBe(d(3, 10));

    await orm.em.fork().nativeDelete(AccountingPeriod, { company: companyId }, FILTER_OFF);
  });

  it('is idempotent with a caller-supplied id, and not without one', async () => {
    const id = randomUUID();
    const first = await asCompany(() => vouchers.post(voucher({ id, memo: 'twice' })));
    const second = await asCompany(() => vouchers.post(voucher({ id, memo: 'twice' })));
    expect(second.id).toBe(first.id);
    expect(await orm.em.fork().count(JournalEntry, { sourceId: id }, FILTER_OFF)).toBe(1);

    // No id supplied = no protection, which is the honest default for a caller who did not ask.
    const a = await asCompany(() => vouchers.post(voucher({ memo: 'unprotected' })));
    const b = await asCompany(() => vouchers.post(voucher({ memo: 'unprotected' })));
    expect(b.id).not.toBe(a.id);
  });

  it('touches neither the budget nor the posting queue', async () => {
    // Both absences are decisions, and an absence nobody asserts is one that comes back.
    const budgetBefore = await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF);
    const queueBefore = await orm.em.fork().count(GlPostingAttempt, {}, FILTER_OFF);

    await asCompany(() => vouchers.post(voucher({ memo: 'no side effects' })));

    expect(await orm.em.fork().count(BudgetTxn, {}, FILTER_OFF)).toBe(budgetBefore);
    expect(await orm.em.fork().count(GlPostingAttempt, {}, FILTER_OFF)).toBe(queueBefore);
  });

  // ── Reversal ─────────────────────────────────────────────────────────────────────────────────

  it('reverses an entry, exchanging the sides and netting to zero', async () => {
    const original = await asCompany(() => vouchers.post(voucher({ memo: 'to be reversed' })));
    const reversal = await asCompany(() => vouchers.reverse(original.id, {}));

    expect(reversal.sourceType).toBe(SOURCE_REVERSAL);
    expect(reversal.sourceId).toBe(original.id);
    expect(reversal.createdBy?.id).toBe(userId);

    const both = [...(await linesOf(original.id)), ...(await linesOf(reversal.id))];
    for (const code of [expenseCode, cashCode]) {
      const net = both
        .filter((l) => l.account.code === code)
        .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
      expect(net).toBe(0);
    }
    // The original is untouched — a correction is a new entry, never an edit.
    const still = await orm.em.fork().findOne(JournalEntry, { id: original.id }, FILTER_OFF);
    expect(still?.memo).toBe('to be reversed');
  });

  it('leaves an engine-posted entry unattributed', async () => {
    // The machine has no author. Naming the approver or the payer would attribute a bookkeeping act
    // to somebody who did not perform one — and it is what makes a MANUAL entry's author mean
    // something when the journal is read.
    const auto = await orm.em.fork().findOne(JournalEntry, { sourceType: 'PAYMENT' }, FILTER_OFF);
    if (auto) expect(auto.createdBy).toBeUndefined();
  });

  it('reverses an AUTOMATIC posting too', async () => {
    // The likelier real case, and the one a careless restriction to manual entries would block.
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(DeptDocType, { department: dept.id, documentType: prType.id }, { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] });
    const doc = em.create(Document, {
      docNo: `JV-AUTO-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: prType, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId),
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: '700.00', createdAt: new Date(),
    } as never);
    await em.flush();
    em.create(BudgetTxn, { budget: em.getReference(Budget, budgetId), document: doc, txnType: BudgetTxnType.ACTUAL, amount: '700.00', createdAt: new Date() } as never);
    em.create(Payment, {
      company: em.getReference(Company, companyId), document: doc,
      lockedRate: '1', actualRate: '1', baseLocked: '700.00', baseActual: '700.00',
      fxDelta: '0.00', fxKind: 'NONE', whtAmount: '0', paidAt: new Date(), createdAt: new Date(),
    } as never);
    await em.flush();
    await posting.postForPayment(doc.id);

    const auto = await orm.em.fork().findOneOrFail(JournalEntry, { sourceType: 'PAYMENT', sourceId: doc.id }, FILTER_OFF);
    const reversal = await asCompany(() => vouchers.reverse(auto.id, {}));
    expect(reversal.sourceId).toBe(auto.id);

    const both = [...(await linesOf(auto.id)), ...(await linesOf(reversal.id))];
    const net = both.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    expect(net).toBe(0);
  });

  it('reverses an entry at most once', async () => {
    const original = await asCompany(() => vouchers.post(voucher({ memo: 'once only' })));
    await asCompany(() => vouchers.reverse(original.id, {}));
    await expect(asCompany(() => vouchers.reverse(original.id, {}))).rejects.toThrow(/already been reversed/);

    const count = await orm.em.fork().count(JournalEntry, { sourceType: SOURCE_REVERSAL, sourceId: original.id }, FILTER_OFF);
    expect(count).toBe(1);
  });

  it('dates a reversal when it was decided, not when the original was', async () => {
    // The original sits in a month that is later closed — often exactly why it is being reversed.
    const original = await asCompany(() => vouchers.post(voucher({ entryDate: d(4, 10), memo: 'in a month to close' })));
    const em = orm.em.fork();
    const fy = await em.findOneOrFail(FiscalYear, { company: companyId }, FILTER_OFF);
    em.create(AccountingPeriod, {
      company: em.getReference(Company, companyId), fiscalYear: fy, code: 'JV-APR',
      periodStart: d(4, 1), periodEnd: d(4, 30), status: AccountingPeriodStatus.CLOSED,
      createdAt: new Date(),
    } as never);
    await em.flush();

    // No date given: today, which is outside the closed month, so it is accepted rather than
    // refused for being dated into a period somebody has already reported.
    const reversal = await asCompany(() => vouchers.reverse(original.id, {}));
    expect(reversal.entryDate).not.toBe(d(4, 10));

    await orm.em.fork().nativeDelete(AccountingPeriod, { company: companyId }, FILTER_OFF);
  });

  it('refuses to reverse another company\'s entry', async () => {
    const em = orm.em.fork();
    const other = em.create(Company, {
      code: 'JV-B', nameTh: 'B', nameEn: 'B', taxId: '99', branchCode: '00000', isActive: true, createdAt: new Date(),
    } as never);
    await em.flush();
    const foreign = em.create(JournalEntry, {
      company: other, entryDate: d(5, 1), sourceType: SOURCE_MANUAL,
      sourceId: randomUUID(), memo: 'theirs', createdAt: new Date(),
    } as never);
    await em.flush();

    await expect(asCompany(() => vouchers.reverse(foreign.id, {}))).rejects.toThrow(/not found/i);
  });
});
