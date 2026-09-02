import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountRoleType, AccountingPeriodStatus, DocStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { AccountingPeriod, AccountingPeriodLog } from '../accounting/period/accounting-period.entities';
import { AccountingPeriodService } from '../accounting/period/accounting-period.service';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { Workflow } from '../approval/approval.entities';
import { Currency, ExchangeRate } from '../currency/currency.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { AccountRoleService } from './account-role.service';
import { FxRevaluationService } from './fx-revaluation.service';
import { AccountRole, JournalEntry, JournalLine } from './gl.entities';
import { SOURCE_FX_REVALUATION, SOURCE_FX_REVALUATION_REVERSAL } from './gl-posting.service';
import { JournalService } from './journal.service';
import { ReceivedNotInvoicedService } from './received-not-invoiced.service';
import { YearCloseService } from './year-close.service';
import type { MikroORM } from '@mikro-orm/postgresql';

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

/**
 * Retranslating what we owe in somebody else's money.
 *
 * A payable is carried at the rate stamped on its document at submit, which is never recomputed
 * (invariant 6). Right for the budget and the approval it passed; wrong for the balance sheet,
 * where a supplier owed 1,000 USD at 34 is reported at 34,000 when it costs 35,000 to pay them.
 */
describe.skipIf(!hasDb)('FX revaluation at period close (DB-backed)', () => {
  let orm: MikroORM;
  let periods: AccountingPeriodService;
  let companyId = '';
  let fiscalYearId = '';
  let userId = '';
  let year = 0;
  let baseCode = '';
  let seq = 0;

  const asCompany = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId, companyId, departmentId: 'd', grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());
    const scope = new CompanyScopeService(orm.em);
    const guard = new PeriodGuardService();
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
    // Read from the seed rather than assumed: the seeded company's base currency is not THB, and a
    // fixture that guesses it tests the guess.
    baseCode = (await em.findOneOrFail(
      Company, { id: companyId }, { ...FILTER_OFF, populate: ['baseCurrency'] },
    )).baseCurrency!.code;
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  const d = (mm: number, dd: number) => `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

  /** An unpaid payable: an accrual crediting AP for a document in `currency`. */
  async function payable(currency: string, foreignAmount: string, carriedBase: string, on: string) {
    const em = orm.em.fork();
    const dept = await em.findOneOrFail(Department, { company: companyId, deptCode: 'PROC' }, FILTER_OFF);
    const type = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(
      DeptDocType, { department: dept.id, documentType: type.id },
      { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] },
    );
    const doc = em.create(Document, {
      docNo: `FX-${++seq}`, company: em.getReference(Company, companyId), department: dept,
      documentType: type, formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, userId), status: DocStatus.COMPLETED,
      currency: em.getReference(Currency, currency),
      totalAmount: foreignAmount, grandTotal: foreignAmount,
      baseTotalAmount: carriedBase, createdAt: new Date(),
    } as never);
    await em.flush();

    const ap = await em.findOneOrFail(
      AccountRole, { company: companyId, role: AccountRoleType.ACCOUNTS_PAYABLE },
      { ...FILTER_OFF, populate: ['account'] },
    );
    const expense = (await em.findOneOrFail(
      AccountRole, { company: companyId, role: AccountRoleType.GRNI }, { ...FILTER_OFF, populate: ['account'] },
    )).account;
    const entry = em.create(JournalEntry, {
      company: em.getReference(Company, companyId), entryDate: on,
      sourceType: 'APPROVAL_ACCRUAL', sourceId: doc.id, memo: 'accrual', createdAt: new Date(),
    } as never);
    em.create(JournalLine, {
      company: em.getReference(Company, companyId), journalEntry: entry,
      account: expense, debit: carriedBase, credit: '0',
    } as never);
    em.create(JournalLine, {
      company: em.getReference(Company, companyId), journalEntry: entry,
      account: ap.account, debit: '0', credit: carriedBase,
    } as never);
    await em.flush();
    return doc.id;
  }

  /** A closing rate for the pair, in force at `on`. */
  async function rate(from: string, to: string, value: string, on: string) {
    const em = orm.em.fork();
    em.create(ExchangeRate, {
      fromCurrency: em.getReference(Currency, from), toCurrency: em.getReference(Currency, to),
      rate: value, rateDate: on, rateType: 'DAILY',
    } as never);
    await em.flush();
  }

  const declare = (code: string, start: string, end: string) =>
    asCompany(() => periods.declare({ fiscalYearId, code, periodStart: start, periodEnd: end }));

  const revaluation = (periodId: string) =>
    orm.em.fork().findOne(
      JournalEntry, { sourceType: SOURCE_FX_REVALUATION, sourceId: periodId },
      { ...FILTER_OFF, populate: ['lines', 'lines.account'] },
    );

  const sideOn = (entry: JournalEntry, role: string, side: 'debit' | 'credit') =>
    entry.lines.getItems()
      .filter((l) => l.account.code === role)
      .reduce((t, l) => t + Number(l[side]), 0);

  const reset = async () => {
    const em = orm.em.fork();
    await em.nativeDelete(JournalLine, {}, FILTER_OFF);
    await em.nativeDelete(JournalEntry, {}, FILTER_OFF);
    // The log first: every period now carries a DECLARE row, so deleting periods without it
    // violates the foreign key.
    await em.nativeDelete(AccountingPeriodLog, {}, FILTER_OFF);
    await em.nativeDelete(AccountingPeriod, { company: companyId }, FILTER_OFF);
    await em.nativeDelete(ExchangeRate, {}, FILTER_OFF);
  };

  /** Account codes the seeded roles resolve to. */
  const codeOf = async (role: AccountRoleType) =>
    (await orm.em.fork().findOneOrFail(
      AccountRole, { company: companyId, role }, { ...FILTER_OFF, populate: ['account'] },
    )).account.code;

  it('posts a LOSS and a bigger payable when the rate rose', async () => {
    await reset();
    // 1,000 USD carried at 34,000. Closing rate 35 → it now takes 35,000 to settle the same debt.
    await payable('USD', '1000.00', '34000.00', d(1, 15));
    await rate('USD', baseCode, '35', d(1, 31));

    const p = await declare('FX-01', d(1, 1), d(1, 31));
    await asCompany(() => periods.close(p.id));

    const entry = await revaluation(p.id);
    expect(entry).not.toBeNull();
    expect(entry!.entryDate).toBe(d(1, 31));
    expect(sideOn(entry!, await codeOf(AccountRoleType.FX_LOSS), 'debit')).toBe(1000);
    expect(sideOn(entry!, await codeOf(AccountRoleType.ACCOUNTS_PAYABLE), 'credit')).toBe(1000);
  });

  it('posts a GAIN and a smaller payable when the rate fell', async () => {
    // Asserted apart from the case above: a sign error is invisible in an entry that still
    // balances, and the intuition that a bigger number is better runs the wrong way for a
    // liability.
    await reset();
    await payable('USD', '1000.00', '34000.00', d(2, 15));
    await rate('USD', baseCode, '33', d(2, 28));

    const p = await declare('FX-02', d(2, 1), d(2, 28));
    await asCompany(() => periods.close(p.id));

    const entry = await revaluation(p.id);
    expect(sideOn(entry!, await codeOf(AccountRoleType.FX_GAIN), 'credit')).toBe(1000);
    expect(sideOn(entry!, await codeOf(AccountRoleType.ACCOUNTS_PAYABLE), 'debit')).toBe(1000);
  });

  it('reverses the day after, so the payable returns to what its accrual raised', async () => {
    await reset();
    await payable('USD', '1000.00', '34000.00', d(3, 10));
    await rate('USD', baseCode, '35', d(3, 31));

    const p = await declare('FX-03', d(3, 1), d(3, 31));
    await asCompany(() => periods.close(p.id));

    const reversal = await orm.em.fork().findOne(
      JournalEntry, { sourceType: SOURCE_FX_REVALUATION_REVERSAL, sourceId: p.id },
      { ...FILTER_OFF, populate: ['lines', 'lines.account'] },
    );
    expect(reversal!.entryDate).toBe(d(4, 1));

    // Across both entries the payable is back at 34,000 — a payment clears it at the amount its
    // accrual raised, so a revaluation left standing would strand its share for good.
    const apCode = await codeOf(AccountRoleType.ACCOUNTS_PAYABLE);
    const em = orm.em.fork();
    const lines = await em.find(JournalLine, {}, { ...FILTER_OFF, populate: ['account'] });
    const apNet = lines
      .filter((l) => l.account.code === apCode)
      .reduce((t, l) => t + Number(l.credit) - Number(l.debit), 0);
    expect(apNet).toBe(34000);
  });

  it('does not revalue a base-currency payable', async () => {
    await reset();
    await payable(baseCode, '50000.00', '50000.00', d(5, 5));
    const p = await declare('FX-05', d(5, 1), d(5, 31));
    await asCompany(() => periods.close(p.id));

    // Nothing to retranslate posts NOTHING — not a zero-value entry.
    expect(await revaluation(p.id)).toBeNull();

    // Asserted on the SERVICE too, not only on the absence of an entry. A base-currency payable
    // resolves at an identity rate, so its difference is zero and the posting filter drops it
    // either way — the empty entry cannot tell whether the currency check ran, and without it every
    // domestic payable would do a rate lookup for nothing.
    const fx = new FxRevaluationService(orm.em, new ExchangeRateService(orm.em));
    expect(await fx.outstanding(companyId, d(5, 31))).toEqual([]);
  });

  it('does not revalue a payable that has been paid', async () => {
    await reset();
    const docId = await payable('USD', '1000.00', '34000.00', d(6, 3));
    await rate('USD', baseCode, '35', d(6, 30));
    const em = orm.em.fork();
    em.create(JournalEntry, {
      company: em.getReference(Company, companyId), entryDate: d(6, 20),
      sourceType: 'PAYMENT', sourceId: docId, memo: 'paid', createdAt: new Date(),
    } as never);
    await em.flush();

    const p = await declare('FX-06', d(6, 1), d(6, 30));
    await asCompany(() => periods.close(p.id));
    expect(await revaluation(p.id)).toBeNull();
  });

  it('revalues once, even after a reopen and re-close', async () => {
    await reset();
    await payable('USD', '1000.00', '34000.00', d(7, 2));
    await rate('USD', baseCode, '35', d(7, 31));

    const p = await declare('FX-07', d(7, 1), d(7, 31));
    await asCompany(() => periods.close(p.id));
    await asCompany(() => periods.reopen(p.id, 'a late adjustment'));
    await asCompany(() => periods.close(p.id));

    const entries = await orm.em.fork().find(
      JournalEntry, { sourceType: SOURCE_FX_REVALUATION, sourceId: p.id }, FILTER_OFF,
    );
    expect(entries).toHaveLength(1);
  });

  it('refuses the close when no rate exists for the pair, leaving the period open', async () => {
    // Falling back to the locked rate would revalue nothing while appearing to; skipping the
    // payable would understate the liability silently. A refusal is the only outcome somebody can
    // act on.
    await reset();
    await payable('USD', '1000.00', '34000.00', d(8, 8));

    const p = await declare('FX-08', d(8, 1), d(8, 31));
    await expect(asCompany(() => periods.close(p.id))).rejects.toThrow(/USD/);

    const after = await orm.em.fork().findOneOrFail(AccountingPeriod, { id: p.id }, FILTER_OFF);
    expect(after.status).toBe(AccountingPeriodStatus.OPEN);
    expect(await revaluation(p.id)).toBeNull();
  });
});
