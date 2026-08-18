import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContext } from '../../common/context/request-context';
import { AccountType, BudgetTxnType, DocStatus, GlPostingStatus } from '../../common/enums';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ALL_ENTITIES, dbAvailable, initTestOrm } from '../../test/test-orm';
import { seedDatabase, SEED_COMPANY_CODE } from '../../seed/seed-data';
import { Account } from '../accounting/accounting.entities';
import { Workflow } from '../approval/approval.entities';
import { BudgetBalanceService } from '../budget/budget-balance.service';
import { Budget, BudgetTxn } from '../budget/budget.entities';
import { Currency } from '../currency/currency.entities';
import { DeptDocType, Document, DocumentType, FormTemplate } from '../document/document.entities';
import { GlPostingAttempt } from '../gl/gl-posting.entities';
import {
  SOURCE_MANUAL,
  SOURCE_PAYMENT,
  SOURCE_REVERSAL,
} from '../gl/gl-posting.service';
import { JournalEntry, JournalLine } from '../gl/gl.entities';
import { JournalVoucher } from '../gl/journal-voucher.entities';
import { JournalService } from '../gl/journal.service';
import { Company, Department, FiscalYear } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { BudgetLedgerReconciliationService } from './budget-ledger-reconciliation.service';
import type { ReconciliationRow } from './budget-ledger-reconciliation.service';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

// Fixtures write budget rows directly; `budget_txn.txn_date` is the day of the event and is
// not nullable, so a fixture must state one just as the ledger service does.
const TODAY = new Date().toISOString().slice(0, 10);

const hasDb = await dbAvailable();
const FILTER_OFF = { filters: { company: false } } as const;

const YEAR = new Date().getUTCFullYear();
/** Inside the seeded fiscal year (Jan 1 – Dec 31 of the current year). */
const IN_YEAR = `${YEAR}-06-15`;
/** Deliberately a DIFFERENT date, not one that happens to coincide with the range's edge. */
const NEXT_YEAR = `${YEAR + 1}-03-02`;

/**
 * The budget against the ledger.
 *
 * Every scenario gets its OWN expense account. The report is per account, and sharing one would let
 * a cause proven in one test leak into another's unexplained remainder — which is the single figure
 * every one of these assertions turns on.
 */
describe.skipIf(!hasDb)('budget-to-ledger reconciliation (DB-backed)', () => {
  let orm: MikroORM;
  let recon: BudgetLedgerReconciliationService;
  let journal: JournalService;
  let companyA = '';
  let companyB = '';
  let fyA = '';
  let deptProc = '';
  let requesterId = '';
  let seq = 0;

  const asA = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: requesterId, companyId: companyA, departmentId: deptProc, grants: [] }, fn);
  const asB = <T>(fn: () => Promise<T>) =>
    RequestContext.run({ userId: requesterId, companyId: companyB, grants: [] }, fn);

  beforeAll(async () => {
    orm = await initTestOrm(ALL_ENTITIES);
    await orm.schema.refreshDatabase();
    await seedDatabase(orm.em.fork());

    const scope = new CompanyScopeService(orm.em);
    recon = new BudgetLedgerReconciliationService(orm.em, new BudgetBalanceService(orm.em));
    journal = new JournalService(scope);

    const em = orm.em.fork();
    companyA = (await em.findOneOrFail(Company, { code: SEED_COMPANY_CODE }, FILTER_OFF)).id;
    fyA = (await em.findOneOrFail(FiscalYear, { company: companyA, year: YEAR }, FILTER_OFF)).id;
    deptProc = (await em.findOneOrFail(Department, { company: companyA, deptCode: 'PROC' }, FILTER_OFF)).id;
    requesterId = (await em.findOneOrFail(AppUser, { username: 'requester' }, FILTER_OFF)).id;

    // A second company with its own budgeted account and its own ledger movement, so isolation is
    // asserted against data that WOULD show up if the scope were missing.
    const currency = await em.findOneOrFail(Currency, { isActive: true }, FILTER_OFF);
    const compB = em.create(Company, {
      code: 'RCB', nameTh: 'Recon B', nameEn: 'Recon B', taxId: '9', branchCode: '00000',
      baseCurrency: currency, isActive: true, createdAt: new Date(),
    } as never);
    const deptB = em.create(Department, { company: compB, deptCode: 'PROC', name: 'Proc B', isActive: true } as never);
    const fyB = em.create(FiscalYear, {
      company: compB, year: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, status: 'OPEN',
    } as never);
    const accB = em.create(Account, {
      company: compB, code: '5000', name: 'B Supplies', accountType: AccountType.EXPENSE,
      isPostable: true, isActive: true,
    } as never);
    const budgetB = em.create(Budget, {
      fiscalYear: fyB, department: deptB, glAccount: '5000', account: accB,
      budgetName: 'B budget', amountTotal: '500000', status: 'ACTIVE',
    } as never);
    await em.flush();
    companyB = compB.id;

    const entryB = em.create(JournalEntry, {
      company: compB, entryDate: IN_YEAR, sourceType: SOURCE_MANUAL, sourceId: budgetB.id,
      memo: 'B voucher', createdAt: new Date(),
    } as never);
    em.create(JournalLine, { company: compB, journalEntry: entryB, account: accB, debit: '777.00', credit: '0' } as never);
    await em.flush();

    await buildFixtures(orm.em.fork());
  });

  afterAll(async () => {
    if (orm) { await orm.schema.dropSchema(); await orm.close(true); }
  });

  // ── fixtures ────────────────────────────────────────────────────────────────────────────────

  /** An expense account plus a budget for it on the seeded fiscal year. */
  async function budgeted(
    em: EntityManager,
    code: string,
    name: string,
    amount: string,
  ): Promise<{ account: Account; budgetId: string }> {
    const account = em.create(Account, {
      company: em.getReference(Company, companyA), code, name,
      accountType: AccountType.EXPENSE, isPostable: true, isActive: true,
    } as never);
    const budget = em.create(Budget, {
      fiscalYear: em.getReference(FiscalYear, fyA), department: em.getReference(Department, deptProc),
      glAccount: code, account, budgetName: name, amountTotal: amount, status: 'ACTIVE',
    } as never);
    await em.flush();
    return { account, budgetId: budget.id };
  }

  /** A completed document in company A, optionally referencing an ancestor. */
  async function document(em: EntityManager, refDocumentId?: string): Promise<Document> {
    const prType = await em.findOneOrFail(DocumentType, { code: 'PR' }, FILTER_OFF);
    const mapping = await em.findOneOrFail(
      DeptDocType,
      { department: deptProc, documentType: prType.id },
      { ...FILTER_OFF, populate: ['formTemplate', 'workflow'] },
    );
    const doc = em.create(Document, {
      docNo: `RECON-${++seq}`,
      company: em.getReference(Company, companyA),
      department: em.getReference(Department, deptProc),
      documentType: prType,
      formTemplate: em.getReference(FormTemplate, mapping.formTemplate.id),
      workflow: em.getReference(Workflow, mapping.workflow.id),
      createdBy: em.getReference(AppUser, requesterId),
      refDocument: refDocumentId ? em.getReference(Document, refDocumentId) : undefined,
      status: DocStatus.COMPLETED, currentStepNo: 1, baseTotalAmount: '1000.00', createdAt: new Date(),
    } as never);
    await em.flush();
    return doc;
  }

  function actual(em: EntityManager, budgetId: string, doc: Document, amount: string, txnDate = TODAY): void {
    em.create(BudgetTxn, {
      budget: em.getReference(Budget, budgetId), document: doc,
      txnType: BudgetTxnType.ACTUAL, txnDate, amount, createdAt: new Date(),
    } as never);
  }

  /** One journal entry with the given lines. */
  function entry(
    em: EntityManager,
    sourceType: string,
    sourceId: string,
    entryDate: string,
    lines: Array<{ account: Account; debit?: string; credit?: string }>,
  ): JournalEntry {
    const e = em.create(JournalEntry, {
      company: em.getReference(Company, companyA), entryDate, sourceType, sourceId,
      memo: `${sourceType} fixture`, createdAt: new Date(),
    } as never);
    for (const l of lines) {
      em.create(JournalLine, {
        company: em.getReference(Company, companyA), journalEntry: e, account: l.account,
        debit: l.debit ?? '0', credit: l.credit ?? '0',
      } as never);
    }
    return e;
  }

  let voucherDocNo = '';
  let transferDocNo = '';
  let skippedDocNo = '';

  async function buildFixtures(em: EntityManager): Promise<void> {
    const cash = await em.findOneOrFail(Account, { company: companyA, code: '1010' }, FILTER_OFF);
    const grni = await em.findOneOrFail(Account, { company: companyA, code: '2150' }, FILTER_OFF);

    // 5100 — nothing but budget-derived postings. The case that proves the arithmetic.
    const clean = await budgeted(em, '5100', 'Recon clean', '100000');
    const cleanDoc = await document(em);
    actual(em, clean.budgetId, cleanDoc, '1000.00');
    entry(em, SOURCE_PAYMENT, cleanDoc.id, IN_YEAR, [
      { account: clean.account, debit: '1000.00' }, { account: cash, credit: '1000.00' },
    ]);
    await em.flush();

    // 5110 — a manual voucher on a budgeted account, and nothing else.
    const vouchered = await budgeted(em, '5110', 'Recon voucher', '100000');
    const voucherDoc = await document(em);
    voucherDocNo = voucherDoc.docNo;
    const voucher = em.create(JournalVoucher, {
      company: em.getReference(Company, companyA), document: voucherDoc, entryDate: IN_YEAR,
      memo: 'Depreciation', createdAt: new Date(),
    } as never);
    await em.flush();
    entry(em, SOURCE_MANUAL, voucher.id, IN_YEAR, [
      { account: vouchered.account, debit: '500.00' }, { account: cash, credit: '500.00' },
    ]);
    await em.flush();

    // 5120 — a stock purchase: charged to the budget, but the stock-tracked share went to GRNI.
    const stock = await budgeted(em, '5120', 'Recon stock', '100000');
    const stockDoc = await document(em);
    actual(em, stock.budgetId, stockDoc, '800.00');
    entry(em, SOURCE_PAYMENT, stockDoc.id, IN_YEAR, [
      { account: stock.account, debit: '300.00' }, { account: grni, debit: '500.00' },
      { account: cash, credit: '800.00' },
    ]);
    await em.flush();

    // 5130 — a payment and the reversal that took it back, with no budget adjustment raised.
    const reversed = await budgeted(em, '5130', 'Recon reversal', '100000');
    const reversedDoc = await document(em);
    actual(em, reversed.budgetId, reversedDoc, '1000.00');
    const original = entry(em, SOURCE_PAYMENT, reversedDoc.id, IN_YEAR, [
      { account: reversed.account, debit: '1000.00' }, { account: cash, credit: '1000.00' },
    ]);
    await em.flush();
    entry(em, SOURCE_REVERSAL, original.id, IN_YEAR, [
      { account: reversed.account, credit: '1000.00' }, { account: cash, debit: '1000.00' },
    ]);
    await em.flush();

    // 5140 — movement dated in the FOLLOWING fiscal year.
    const later = await budgeted(em, '5140', 'Recon later', '100000');
    const laterVoucherDoc = await document(em);
    const laterVoucher = em.create(JournalVoucher, {
      company: em.getReference(Company, companyA), document: laterVoucherDoc, entryDate: NEXT_YEAR,
      memo: 'Next year', createdAt: new Date(),
    } as never);
    await em.flush();
    entry(em, SOURCE_MANUAL, laterVoucher.id, NEXT_YEAR, [
      { account: later.account, debit: '4200.00' }, { account: cash, credit: '4200.00' },
    ]);
    await em.flush();

    // 5160 / 5170 — the back door itself: one voucher moving expense BETWEEN two budgeted
    // accounts, with no availability check consulted for either. It nets to zero across them,
    // which is why the headline figure counts what a voucher CHARGED rather than what it netted.
    const fromAcc = await budgeted(em, '5160', 'Recon jv from', '100000');
    const toAcc = await budgeted(em, '5170', 'Recon jv to', '100000');
    const transferDoc = await document(em);
    transferDocNo = transferDoc.docNo;
    const transferVoucher = em.create(JournalVoucher, {
      company: em.getReference(Company, companyA), document: transferDoc, entryDate: IN_YEAR,
      memo: 'Reclassify', createdAt: new Date(),
    } as never);
    // …and a third voucher touching only UNBUDGETED accounts, which must not appear at all.
    const unbudgetedDoc = await document(em);
    const unbudgetedVoucher = em.create(JournalVoucher, {
      company: em.getReference(Company, companyA), document: unbudgetedDoc, entryDate: IN_YEAR,
      memo: 'Bank fee', createdAt: new Date(),
    } as never);
    await em.flush();
    entry(em, SOURCE_MANUAL, transferVoucher.id, IN_YEAR, [
      { account: toAcc.account, debit: '900.00' }, { account: fromAcc.account, credit: '900.00' },
    ]);
    entry(em, SOURCE_MANUAL, unbudgetedVoucher.id, IN_YEAR, [
      { account: grni, debit: '50.00' }, { account: cash, credit: '50.00' },
    ]);
    await em.flush();

    // 5150 — a document that charged the budget and whose posting never arrived.
    const stranded = await budgeted(em, '5150', 'Recon stranded', '100000');
    const strandedDoc = await document(em);
    actual(em, stranded.budgetId, strandedDoc, '600.00');
    await em.flush();

    // 5160 — a December document settled in January: charged to THIS year's appropriation on a day
    // the ledger will post into the next. The case that used to land in `unexplained` every year.
    const crossingLate = await budgeted(em, '5180', 'Recon crossing late', '100000');
    const lateDoc = await document(em);
    actual(em, crossingLate.budgetId, lateDoc, '400.00', `${YEAR + 1}-01-05`);
    await em.flush();

    // 5170 — one crossing each way, of equal size. They net to nothing if added, which is why they
    // are reported apart.
    const crossingBoth = await budgeted(em, '5190', 'Recon crossing both', '100000');
    const earlyDoc = await document(em);
    const lateDoc2 = await document(em);
    actual(em, crossingBoth.budgetId, earlyDoc, '250.00', `${YEAR - 1}-12-28`);
    actual(em, crossingBoth.budgetId, lateDoc2, '250.00', `${YEAR + 1}-01-03`);
    await em.flush();

    // The blind spot: a document with NO budget at all, whose posting was recorded SKIPPED.
    const noBudgetDoc = await document(em);
    skippedDocNo = noBudgetDoc.docNo;
    em.create(GlPostingAttempt, {
      company: em.getReference(Company, companyA), sourceType: SOURCE_PAYMENT, sourceId: noBudgetDoc.id,
      status: GlPostingStatus.SKIPPED, attempts: 0, createdAt: new Date(), lastAttemptAt: new Date(),
    } as never);
    // …beside a SKIPPED posting whose document DID charge a budget: the skip was an answer.
    em.create(GlPostingAttempt, {
      company: em.getReference(Company, companyA), sourceType: SOURCE_PAYMENT, sourceId: cleanDoc.id,
      status: GlPostingStatus.SKIPPED, attempts: 0, createdAt: new Date(), lastAttemptAt: new Date(),
    } as never);
    await em.flush();
  }

  const rowFor = async (code: string): Promise<ReconciliationRow> => {
    const result = await asA(() => recon.reconcile({ fiscalYearId: fyA }));
    const row = result.rows.find((r) => r.accountCode === code);
    expect(row, `no reconciliation row for account ${code}`).toBeDefined();
    return row!;
  };

  const causeOf = (row: ReconciliationRow, sourceType: string): string =>
    row.sourcesWithoutBudget.find((c) => c.sourceType === sourceType)?.amount ?? '0';

  // ── the two figures ─────────────────────────────────────────────────────────────────────────

  it('reports the budget side, the ledger side and the difference between them', async () => {
    const row = await rowFor('5100');
    expect(row.appropriated).toBe('100000');
    expect(row.committed).toBe('-1000'); // ACTUAL with no RESERVE behind it, in this fixture
    expect(row.consumed).toBe('1000');
    expect(row.moved).toBe('1000');
    expect(row.difference).toBe('0');
  });

  it('an account with only budget-derived postings leaves nothing unexplained', async () => {
    expect((await rowFor('5100')).unexplained).toBe('0');
  });

  // ── the decomposition ───────────────────────────────────────────────────────────────────────

  it('explains a manual voucher on a budgeted account, leaving the remainder zero', async () => {
    const row = await rowFor('5110');
    expect(row.consumed).toBe('0');
    expect(row.moved).toBe('500');
    expect(causeOf(row, SOURCE_MANUAL)).toBe('500');
    expect(row.unexplained).toBe('0');
  });

  it('explains a stock purchase by its capitalisation, leaving the remainder zero', async () => {
    const row = await rowFor('5120');
    expect(row.consumed).toBe('800');
    expect(row.moved).toBe('300');
    expect(row.capitalisedIntoStock).toBe('500');
    expect(row.unexplained).toBe('0');
  });

  it('a reversal reduces the ledger movement and does NOT reduce what the budget consumed', async () => {
    const row = await rowFor('5130');
    // The divergence, stated: the ledger took the expense back, the budget still calls it spent.
    expect(row.moved).toBe('0');
    expect(row.consumed).toBe('1000');
    expect(causeOf(row, SOURCE_REVERSAL)).toBe('-1000');
    expect(row.unexplained).toBe('0');
  });

  it('excludes movement dated outside the fiscal year', async () => {
    const row = await rowFor('5140');
    expect(row.moved).toBe('0');
    expect(row.sourcesWithoutBudget).toHaveLength(0);
  });

  it('reports budget consumption whose posting never arrived', async () => {
    const row = await rowFor('5150');
    expect(row.consumed).toBe('600');
    expect(row.moved).toBe('0');
    expect(row.postingNeverArrived).toBe('600');
    expect(row.unexplained).toBe('0');
  });

  // ── the year boundary ───────────────────────────────────────────────────────────────────────
  //
  // The budget side is grouped by the appropriation's own year; the ledger side by `entry_date`.
  // They agree for anything submitted and completed inside one year, and part company at the
  // boundary — which used to land in `unexplained`, in a report whose requirement is that nothing
  // should.

  it('explains consumption dated after the year of the appropriation it drew on', async () => {
    const row = await rowFor('5180');
    expect(row.consumed).toBe('400');
    expect(row.moved).toBe('0');
    expect(row.consumedAfterItsYear).toBe('400');
    expect(row.consumedBeforeItsYear).toBe('0');
    expect(row.unexplained).toBe('0');
  });

  it('names the documents behind the crossing', async () => {
    const row = await rowFor('5180');
    expect(row.crossingCount).toBe(1);
    expect(row.crossings).toHaveLength(1);
    expect(row.crossings[0].txnDate).toBe(`${YEAR + 1}-01-05`);
    expect(row.crossings[0].documentNo).toBeTruthy();
    expect(row.crossings[0].amount).toBe('400.00');
  });

  it('keeps an early crossing and a late one apart rather than netting them', async () => {
    const row = await rowFor('5190');
    expect(row.consumedBeforeItsYear).toBe('250');
    expect(row.consumedAfterItsYear).toBe('250');
    expect(row.crossingCount).toBe(2);
    expect(row.unexplained).toBe('0');
  });

  it('still counts a crossing row in the year of its appropriation', async () => {
    // Explained, not removed: the report must not balance by losing the evidence.
    const row = await rowFor('5190');
    expect(row.consumed).toBe('500');
  });

  it('reports no crossing for an account whose consumption stayed inside its year', async () => {
    const row = await rowFor('5150');
    expect(row.consumedBeforeItsYear).toBe('0');
    expect(row.consumedAfterItsYear).toBe('0');
    expect(row.crossings).toHaveLength(0);
  });

  // ── the vouchers figure ─────────────────────────────────────────────────────────────────────

  it('reports the vouchers-on-budgeted-accounts figure and the vouchers behind it', async () => {
    const result = await asA(() => recon.reconcile({ fiscalYearId: fyA }));
    const { total, entries } = result.vouchersOnBudgetedAccounts;
    // The two that touched a budgeted account; the third, on unbudgeted accounts only, is absent.
    expect(entries.map((e) => e.docNo).sort()).toEqual([voucherDocNo, transferDocNo].sort());
    expect(total).toBe('1400');
  });

  it('counts what a voucher CHARGED to budgeted accounts, not what it netted across them', async () => {
    // A reclassification debits one budgeted account and credits another: it nets to zero while
    // having moved 900 past two ceilings with no availability check consulted for either. Netted,
    // the back door would report as unused at the moment it was used.
    const result = await asA(() => recon.reconcile({ fiscalYearId: fyA }));
    const transfer = result.vouchersOnBudgetedAccounts.entries.find((e) => e.docNo === transferDocNo);
    expect(transfer?.amount).toBe('900');
    expect((await rowFor('5170')).moved).toBe('900');
    expect((await rowFor('5160')).moved).toBe('-900');
  });

  it('reports zero rather than nothing when no voucher touched a budgeted account', async () => {
    // A fiscal year nothing has happened in: the figure must still be reported, as zero. Absent, a
    // reader cannot tell "no voucher took that path" from "nobody looked".
    const em = orm.em.fork();
    const nextYear = em.create(FiscalYear, {
      company: em.getReference(Company, companyA), year: YEAR + 5,
      startDate: `${YEAR + 5}-01-01`, endDate: `${YEAR + 5}-12-31`, status: 'OPEN',
    } as never) as unknown as FiscalYear;
    await em.flush();

    const result = await asA(() => recon.reconcile({ fiscalYearId: nextYear.id }));
    expect(result.vouchersOnBudgetedAccounts.total).toBe('0');
    expect(result.vouchersOnBudgetedAccounts.entries).toEqual([]);
  });

  // ── the blind spot ──────────────────────────────────────────────────────────────────────────

  it('lists a document with no budget, and contributes nothing to the reconciliation', async () => {
    const skipped = await asA(() => journal.skippedForWantOfBudget());
    const row = skipped.find((s) => s.documentNo === skippedDocNo);
    expect(row, 'the document with no budget is missing from the skipped read').toBeDefined();
    expect(row!.baseTotalAmount).toBe('1000.00');
    expect(row!.documentStatus).toBe(DocStatus.COMPLETED);

    // …and the other half, which is the whole point: the reconciliation is blind to it. The
    // document charged no budget and produced no entry, so it moves no figure on any row — and
    // every row still reconciles to zero at the exact moment an entire expense is missing from
    // both books. That is why the read above ships in the same change rather than as a follow-up.
    const result = await asA(() => recon.reconcile({ fiscalYearId: fyA }));
    expect(result.rows.every((r) => r.unexplained === '0')).toBe(true);
    const consumed = result.rows.reduce((s, r) => s + Number(r.consumed), 0);
    const moved = result.rows.reduce((s, r) => s + Number(r.moved), 0);
    // 1000 (clean) + 800 (stock) + 1000 (reversed) + 600 (stranded) + 400 (crossed late)
    // + 500 (crossed both ways); the skipped 1000 is in neither book. The crossings are counted
    // here deliberately: they consumed THIS year's appropriation, and the report explains them
    // rather than dropping them.
    expect(consumed).toBe(4300);
    // 1000 (clean) + 500 (voucher) + 300 (stock) + 0 (reversed, netted) + 0 (stranded).
    expect(moved).toBe(1800);
  });

  it('omits a SKIPPED posting whose document did charge a budget', async () => {
    const skipped = await asA(() => journal.skippedForWantOfBudget());
    expect(skipped.map((s) => s.documentNo)).not.toContain('RECON-1');
  });

  it('leaves the undelivered read alone — SKIPPED is still absent from it', async () => {
    const undelivered = await asA(() => journal.undelivered({ limit: 200 }));
    expect(undelivered.items.every((r) => r.status !== GlPostingStatus.SKIPPED)).toBe(true);
    // And what the new read returns is not offered as owed, so no close can be blocked by it.
    const skipped = await asA(() => journal.skippedForWantOfBudget());
    expect(skipped.length).toBeGreaterThan(0);
    expect(undelivered.items.map((r) => r.sourceId)).not.toContain(skipped[0].sourceId);
  });

  // ── scope and read-only ─────────────────────────────────────────────────────────────────────

  it('keeps each company to its own budgets, entries and skipped postings', async () => {
    const a = await asA(() => recon.reconcile({ fiscalYearId: fyA }));
    expect(a.rows.some((r) => r.accountCode === '5100')).toBe(true);
    // Company B's 777 sits on ITS account '5000'; company A's own '5000' must not have picked it up.
    expect(a.rows.find((r) => r.accountCode === '5000')?.moved ?? '0').not.toBe('777');

    const fyBId = (await orm.em.fork().findOneOrFail(FiscalYear, { company: companyB }, FILTER_OFF)).id;
    const b = await asB(() => recon.reconcile({ fiscalYearId: fyBId }));
    expect(b.rows.map((r) => r.accountCode)).toEqual(['5000']);
    expect(b.rows[0].moved).toBe('777');
    expect(await asB(() => journal.skippedForWantOfBudget())).toEqual([]);
  });

  it('offers the active company\'s fiscal years, and only those', async () => {
    // Returned with the report because `GET /fiscal-years` needs FISCAL_YEAR_MANAGE, which the
    // people who have to explain the difference have no reason to hold.
    const a = await asA(() => recon.reconcile({ fiscalYearId: fyA }));
    expect(a.fiscalYears.map((y) => y.id)).toContain(fyA);
    const fyBId = (await orm.em.fork().findOneOrFail(FiscalYear, { company: companyB }, FILTER_OFF)).id;
    expect(a.fiscalYears.map((y) => y.id)).not.toContain(fyBId);
    expect(a.fiscalYear.id).toBe(fyA);
  });

  it('refuses a fiscal year that belongs to another company', async () => {
    const fyBId = (await orm.em.fork().findOneOrFail(FiscalYear, { company: companyB }, FILTER_OFF)).id;
    // Refused ON THE YEAR, not incidentally further down: a company's own fiscal year is the first
    // thing the read resolves, so naming it is what proves the scope was applied there.
    await expect(asA(() => recon.reconcile({ fiscalYearId: fyBId }))).rejects.toThrow(
      new RegExp(`Fiscal year ${fyBId} not found`),
    );
  });

  it('writes nothing — counted before and after', async () => {
    const em = orm.em.fork();
    const counts = async () => [
      await em.count(BudgetTxn, {}, FILTER_OFF),
      await em.count(JournalEntry, {}, FILTER_OFF),
      await em.count(JournalLine, {}, FILTER_OFF),
      await em.count(GlPostingAttempt, {}, FILTER_OFF),
    ];
    const before = await counts();
    await asA(() => recon.reconcile({ fiscalYearId: fyA }));
    await asA(() => recon.reconcile({ fiscalYearId: fyA }));
    await asA(() => journal.skippedForWantOfBudget());
    expect(await counts()).toEqual(before);
  });
});
