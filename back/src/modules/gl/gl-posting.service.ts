import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { AccountRoleType, BudgetTxnType, GlPostingStatus, StockTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { localDateIn } from '../../common/time/company-clock';
import { Account } from '../accounting/accounting.entities';
import { BudgetTxn } from '../budget/budget.entities';
import { Document, DocumentLine, DocumentType } from '../document/document.entities';
import { StockTxn } from '../inventory/inventory.entities';
import { ItemCompany } from '../master-data/master-data.entities';
import { AccountService } from '../accounting/account.service';
import { Company } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { PeriodGuardService } from '../accounting/period/period-guard.service';
import { AccountRoleService } from './account-role.service';
import { GlPostingAttempt } from './gl-posting.entities';
import { JournalEntry, JournalLine } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;
export const SOURCE_PAYMENT = 'PAYMENT';
// Distinct from SOURCE_PAYMENT on purpose: one document may carry both an accrual and, later, a
// settlement entry, and journal_entry is unique per (company, source_type, source_id).
export const SOURCE_ACCRUAL = 'APPROVAL_ACCRUAL';
export const SOURCE_SETTLEMENT = 'CLAIM_SETTLEMENT';

/**
 * What each settlement type pays out of.
 *
 * A lookup rather than a branch on purpose: this is the seam a settlement in goods will use, and
 * INVENTORY is already a role. Adding it there should be a line in this map, not a rewrite.
 */
const SETTLEMENT_CREDIT_ROLE: Record<string, AccountRoleType | undefined> = {
  CASH: AccountRoleType.CASH_CLEARING,
};
export const SOURCE_STOCK = 'STOCK_TXN';
/** The entry no event produced: a person wrote it. Depreciation, an accrual, opening balances. */
export const SOURCE_MANUAL = 'MANUAL_JV';
/**
 * A correction. Keyed by the ENTRY it reverses, so `(company, REVERSAL, entryId)` makes "reversed
 * at most once" a property of the index rather than of a check somebody has to remember.
 */
export const SOURCE_REVERSAL = 'REVERSAL';
/**
 * A period's accrual for what was received and not invoiced, and its reversal the following day.
 * Both keyed by the PERIOD's id, so re-closing cannot post either twice — and so the figure belongs
 * to the close that computed it.
 */
export const SOURCE_PERIOD_ACCRUAL = 'PERIOD_ACCRUAL';
export const SOURCE_PERIOD_ACCRUAL_REVERSAL = 'PERIOD_ACCRUAL_REVERSAL';
/** A fiscal year's result rolled into equity. Keyed by the YEAR, so it can be posted once. */
export const SOURCE_YEAR_CLOSE = 'YEAR_CLOSE';
/** Posted-amount scale. Inventory cost is carried at 6 dp; GL amounts round to the currency's. */
const VALUE_DP = 2;

interface DraftLine {
  account: Account;
  debit: string;
  credit: string;
}

/**
 * What one posting attempt concluded, and for whom. `null` from a posting body means "this is not
 * a posting source" — no row is recorded at all.
 */
interface Outcome {
  companyId: string;
  status: GlPostingStatus;
}

/**
 * Upsert one source's outcome row inside a caller-supplied transaction.
 *
 * `attempts` counts FAILURES only: a row that posted on the third try keeps its two, so the number
 * reads as "how much trouble was this" rather than "how many times was this touched". `lastError`
 * survives a later success for the same reason — the record of what went wrong outlives the fix.
 */
async function recordOn(
  tem: EntityManager,
  companyId: string,
  sourceType: string,
  sourceId: string,
  status: GlPostingStatus,
  error?: string,
): Promise<void> {
  const existing = await tem.findOne(
    GlPostingAttempt,
    { company: companyId, sourceType, sourceId },
    FILTER_OFF,
  );
  const row =
    existing ??
    tem.create(GlPostingAttempt, {
      company: tem.getReference(Company, companyId),
      sourceType,
      sourceId,
      status,
      attempts: 0,
      createdAt: new Date(),
    });
  row.status = status;
  row.lastAttemptAt = new Date();
  if (status === GlPostingStatus.FAILED) {
    row.attempts += 1;
    row.lastError = error;
  }
  tem.persist(row);
}

/**
 * The `YYYY-MM-DD` an entry is dated, in the POSTING COMPANY'S own timezone.
 *
 * `entry_date` is the one field that decides which period a figure belongs to — `financial-reports`
 * ranges the trial balance, account ledger and income statement over it, and derives the balance
 * sheet from `entry_date <= asOf`. Deriving it with `toISOString()` (UTC) dated every event in the
 * seven hours before 07:00 local to the previous day at UTC+7: a payment recorded 06:30 on 1 August
 * in Vientiane is 23:30 on 31 July UTC, and landed in the July statements.
 *
 * Takes the company rather than a timezone string so "the *posting company's* day" stays visible at
 * each call site, and deliberately does NOT fall back to UTC when the zone is absent —
 * `company.timezone` is NOT NULL with a default, so a missing value is a data fault worth
 * surfacing, and papering over it is the behaviour being removed.
 *
 * This is also the single seam an accounting-period guard will sit at: every entry this service
 * writes gets its date here, so "is that day open?" has exactly one place to be asked.
 */
function entryDateFor(company: Company, instant: Date): string {
  return localDateIn(instant, company.timezone);
}

export interface EntryDraft {
  company: Company;
  /** The moment the posted event happened; converted to the company's calendar day. */
  instant: Date;
  sourceType: string;
  sourceId: string;
  memo: string;
  lines: DraftLine[];
  /**
   * Who wrote it, when a person did. Left unset by the posting engine on purpose: an entry the
   * machine produced from an event has no author, and naming the approver or the payer would
   * attribute a bookkeeping act to somebody who did not perform one. A manual voucher sets it,
   * and that attribution is one of the controls standing in for an approval route.
   */
  createdById?: string;
}

/**
 * The ONLY place a `journal_entry` and its lines are persisted.
 *
 * Before this existed, four paths built the header and its lines by hand and only two of them
 * checked that the sides balanced; the accrual and the claim settlement were balanced *by
 * construction*, which is a property of how they happen to be written rather than a guarantee —
 * and the accrual is the path the accounts-payable work is about to change. `Balanced Entry
 * Invariant` says the system must reject an unbalanced entry before it is persisted; after this it
 * is one function that can be pointed at.
 *
 * It is also where the accounting-period guard will sit, for the same reason `entryDateFor` above
 * resolves the day here: every entry passes this point, so "is that day open?" gets asked once.
 *
 * Exported for its own test. Every posting path balances by construction, so the refusal cannot be
 * reached through one of them — and a guarantee with no test that can fail is the property this
 * function exists to replace.
 */
export async function createEntry(
  tem: EntityManager,
  draft: EntryDraft,
  /**
   * Required, not optional. This is the function every entry in the system passes through, and an
   * optional guard is a guard somebody forgets — which here would mean silently writing into a
   * month that has been reported and acted on.
   */
  periods: PeriodGuardService,
): Promise<JournalEntry> {
  const totalDebit = draft.lines.reduce((s, l) => Money.add(s, l.debit), '0');
  const totalCredit = draft.lines.reduce((s, l) => Money.add(s, l.credit), '0');
  if (Money.compare(totalDebit, totalCredit) !== 0) {
    throw new Error(
      `Unbalanced journal entry for ${draft.sourceType} ${draft.sourceId}: ` +
        `debit ${totalDebit} != credit ${totalCredit}`,
    );
  }

  const companyId = draft.company.id;
  const entryDate = entryDateFor(draft.company, draft.instant);
  // The day is resolved once, here, so "is that day open?" is asked once too. A date no declared
  // period covers passes; a closed one throws, and the throw becomes a recorded, queryable,
  // re-queueable posting failure like any other — no entry is lost by refusing it.
  await periods.assertOpen(tem, companyId, entryDate);

  const entry = tem.create(JournalEntry, {
    company: tem.getReference(Company, companyId),
    entryDate,
    sourceType: draft.sourceType,
    sourceId: draft.sourceId,
    memo: draft.memo,
    createdBy: draft.createdById ? tem.getReference(AppUser, draft.createdById) : undefined,
    createdAt: new Date(),
  });
  tem.persist(entry);
  for (const l of draft.lines) {
    tem.persist(
      tem.create(JournalLine, {
        company: tem.getReference(Company, companyId),
        journalEntry: entry,
        account: tem.getReference(Account, l.account.id),
        debit: l.debit,
        credit: l.credit,
      }),
    );
  }
  return entry;
}


/**
 * The budget account behind each of one document's lines, keyed by `line_no`.
 *
 * The account comes from the line's budget, deliberately not from the item's `default_gl_account`.
 * The item route lands on the same account today — that GL is how the budget was resolved in the
 * first place — but re-deriving it means an item whose default GL is edited after its predecessor
 * was approved would clear a different account than the budget was cut on, silently, with the entry
 * still balancing.
 *
 * Exported because this is the FOURTH place needing "the budget account behind a chained line":
 * `cutBudget` walks for it, `settlementActuals` walks for its ACTUAL rows, `stockPortionByAccount`
 * uses it here, and the period-close accrual reads purchase-order lines that carry no budget at all
 * because a PO type is not budget-controlled. `raise-the-payable`'s design said the fourth should
 * make it a helper rather than a fourth copy; this is that. The other two are deliberately left
 * alone — they work, their tests pass, and rewriting three working paths to make a point about
 * duplication is how a small change becomes a risky one.
 */
export async function accountByLineOf(
  tem: EntityManager,
  documentId: string,
): Promise<Map<number, Account>> {
  const byLine = new Map<number, Account>();
  const lines = await tem.find(
    DocumentLine,
    { document: documentId },
    { ...FILTER_OFF, populate: ['budget.account'] },
  );
  for (const l of lines) {
    if (l.budget?.account) byLine.set(l.lineNo, l.budget.account);
  }
  return byLine;
}

/**
 * Walk `ref_document_id` upward until a document's lines carry budget accounts, and return them by
 * `line_no`. Empty when nothing up the chain has any.
 *
 * `create-from` copies a chain 1:1 with `line_no` preserved, which is the assumption `cutBudget`
 * already settles a chained document through — shared here rather than invented.
 */
export async function ancestorAccountByLine(
  tem: EntityManager,
  documentId: string,
): Promise<Map<number, Account>> {
  const seen = new Set<string>([documentId]);
  let currentId = (
    await tem.findOne(Document, { id: documentId }, { ...FILTER_OFF, populate: ['refDocument'] })
  )?.refDocument?.id;

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const found = await accountByLineOf(tem, currentId);
    if (found.size) return found;
    const ancestor = await tem.findOne(
      Document,
      { id: currentId },
      { ...FILTER_OFF, populate: ['refDocument'] },
    );
    currentId = ancestor?.refDocument?.id;
  }
  return new Map();
}

/**
 * Posts a balanced double-entry journal entry when a disbursement settles. Runs post-commit
 * off `payment.settled`, in its own transaction, and NEVER writes budget_txn (invariant 6).
 * Idempotent per source document so event retries don't double-post.
 */
@Injectable()
export class GlPostingService {
  private readonly logger = new Logger(GlPostingService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly roles: AccountRoleService,
    // Resolves an item's per-company GL code to a postable account for the issue entry.
    private readonly accounts: AccountService,
    // Answers whether the day an entry resolves to is still open.
    private readonly periods: PeriodGuardService,
  ) {}

  /**
   * Run one posting attempt and record what happened on its `gl_posting_attempt` row.
   *
   * The outcome is recorded in its OWN transaction, after the posting's, never inside it. Two
   * reasons, and they pull the same way:
   *
   *  · a FAILED outcome cannot be written inside a transaction that is rolling back, which is
   *    exactly the case that most needs recording;
   *  · `journal_entry` is the authority on whether a posting happened (design D1), so a POSTED row
   *    is an echo. If the process dies between the entry and its echo, reconciliation finds the
   *    entry, concludes there is nothing owed, and moves on. Nothing is lost.
   *
   * `body` returns `null` when the source is not a posting source at all — a document of a type
   * that does not accrue, a stock row that vanished. Those get no row: a row per approved document
   * in the system would be write amplification for a question nobody asks.
   *
   * The error is rethrown. The listener above still swallows it for the business flow's sake; the
   * sweeper needs to know the attempt failed.
   */
  private async attempt(
    sourceType: string,
    sourceId: string,
    companyOnFailure: () => Promise<string | null>,
    body: () => Promise<Outcome | null>,
  ): Promise<void> {
    let outcome: Outcome | null;
    try {
      outcome = await body();
    } catch (err) {
      const companyId = await companyOnFailure().catch(() => null);
      if (companyId) {
        await this.record(companyId, sourceType, sourceId, GlPostingStatus.FAILED, (err as Error).message);
      } else {
        // Nowhere to file it: without a company the row cannot satisfy invariant 1. The throw below
        // still reaches the listener's log, which is what this case had before.
        this.logger.error(
          `GL posting failed for ${sourceType} ${sourceId} and its company could not be resolved to record it`,
        );
      }
      throw err;
    }
    if (outcome) {
      await this.record(outcome.companyId, sourceType, sourceId, outcome.status);
    }
  }

  /**
   * Upsert the row for one source. NEVER throws: the business transaction has already committed and
   * the posting itself is forbidden to disturb it, so a bookkeeping row is certainly not allowed to.
   *
   * `attempts` only counts failures — a POSTED row that took three tries keeps the three, which is
   * what makes the count read as "how much trouble was this" rather than "how many times was this
   * touched". `lastError` is left in place on success for the same reason: the history of what went
   * wrong survives the fix.
   */
  private async record(
    companyId: string,
    sourceType: string,
    sourceId: string,
    status: GlPostingStatus,
    error?: string,
  ): Promise<void> {
    try {
      await this.em.fork().transactional((tem) => recordOn(tem, companyId, sourceType, sourceId, status, error));
    } catch (e) {
      this.logger.error(
        `Could not record the ${status} outcome for ${sourceType} ${sourceId}: ${(e as Error).message}`,
      );
    }
  }

  /** The company of a document, for filing a failure against. Null when it cannot be resolved. */
  private async companyOfDocument(documentId: string): Promise<string | null> {
    const doc = await this.em
      .fork()
      .findOne(Document, { id: documentId }, { ...FILTER_OFF, populate: ['company'] });
    return doc?.company.id ?? null;
  }

  /** The company of a stock movement, for filing a failure against. */
  private async companyOfStockTxn(stockTxnId: string): Promise<string | null> {
    const txn = await this.em
      .fork()
      .findOne(StockTxn, { id: stockTxnId }, { ...FILTER_OFF, populate: ['company'] });
    return txn?.company.id ?? null;
  }

  /**
   * Build and persist the entry for a settled document, atomically. Reads the payment
   * (base amounts + FX) and the document's budget_txn ACTUAL rows (→ expense accounts).
   * Debit each expense account at the locked base, credit cash-clearing at the actual base,
   * and post the FX delta to the realized FX gain/loss account.
   */
  async postForPayment(documentId: string): Promise<void> {
    await this.attempt(
      SOURCE_PAYMENT,
      documentId,
      () => this.companyOfDocument(documentId),
      () => this.doPostForPayment(documentId),
    );
  }

  private async doPostForPayment(documentId: string): Promise<Outcome | null> {
    return this.em.transactional(async (tem) => {
      const payment = await tem.findOne(
        Payment,
        { document: documentId },
        { ...FILTER_OFF, populate: ['company'] },
      );
      if (!payment) {
        // Not a settled-payment source at all, so nothing is owed and nothing is recorded — the
        // reconciliation pass enumerates payments, and this document has none.
        this.logger.warn(`GL posting skipped: no payment for document ${documentId}`);
        return null;
      }
      const companyId = payment.company.id;

      // Idempotency: one entry per source document per company.
      const existing = await tem.findOne(
        JournalEntry,
        { company: companyId, sourceType: SOURCE_PAYMENT, sourceId: documentId },
        FILTER_OFF,
      );
      if (existing) return { companyId, status: GlPostingStatus.POSTED };

      // ── The branch that makes this incremental ───────────────────────────────────────────────
      // When the document was accrued at approval, its expense, input VAT and GRNI were all posted
      // then; the payment moves cash and clears the debt, nothing more. Debiting expense again here
      // would recognise the same purchase twice — which is exactly what the now-removed
      // `assertRecognisedOnce` rejection used to prevent, and this branch is what replaces it.
      //
      // When it was not, everything below runs exactly as it always has. That is why a type can opt
      // into accrual on its own schedule and why every document approved before it did keeps its
      // old posting for the rest of its life.
      const accrued = await this.accruedPayable(tem, companyId, documentId);
      if (accrued) {
        // Cleared at the amount it was RAISED at, not at `base_actual`: the payable was raised at
        // the locked rate, so `payable + fx_delta = base_actual = cash + wht` balances by
        // construction and the whole rate difference lands in FX where it belongs. Clearing at any
        // other figure would leave a residue the FX line absorbs by accident.
        const lines: DraftLine[] = [{ account: accrued.account, debit: accrued.amount, credit: '0' }];
        await this.appendPaymentTail(tem, companyId, payment, lines);
        const doc = await tem.findOne(Document, { id: documentId }, FILTER_OFF);
        await createEntry(tem, {
          company: payment.company,
          instant: payment.paidAt ?? payment.createdAt ?? new Date(),
          sourceType: SOURCE_PAYMENT,
          sourceId: documentId,
          memo: `Settlement of ${doc?.docNo ?? documentId}`,
          lines,
        }, this.periods);
        return { companyId, status: GlPostingStatus.POSTED };
      }

      // Expense side: sum the ACTUAL cuts per budget account (locked basis). The settlement may
      // have been posted against a ref-chain ancestor rather than this document — a chain holds
      // ONE reservation and PostActionService settles the holder — so follow the same chain here.
      const actuals = await this.settlementActuals(tem, documentId);
      if (actuals.length === 0) {
        // A real no-op, not a failure: nothing was charged, so there is no expense side to post.
        // Recorded terminally so the undelivered read never has to re-derive this rule (design D2).
        this.logger.warn(`GL posting skipped: no ACTUAL budget_txn for document ${documentId}`);
        return { companyId, status: GlPostingStatus.SKIPPED };
      }
      const perAccount = new Map<string, { account: Account; amount: string }>();
      for (const txn of actuals) {
        const account = txn.budget.account;
        if (!account) {
          // A legacy budget without a resolved account — fail the posting (retry after backfill).
          throw new Error(`Budget ${txn.budget.id} has no account_id; cannot post document ${documentId}`);
        }
        const cur = perAccount.get(account.id);
        perAccount.set(account.id, {
          account,
          amount: cur ? Money.add(cur.amount, txn.amount) : txn.amount,
        });
      }

      /**
       * Goods already capitalized into inventory must NOT be expensed again here.
       *
       * A stock-tracked line was debited to INVENTORY when it was received (Dr Inventory / Cr
       * GRNI); this payment settles that liability, so its share of the document goes to GRNI,
       * not to the expense account. Expense is charged once, when the goods are issued. Without
       * this split the same purchase would hit P&L twice — once here and once at issue.
       *
       * The share is taken per budget account from the document's own stock-tracked lines, using
       * the same `budget_base_line_amount` basis the budget was cut on, so the two always agree.
       */
      const stockByAccount = await this.stockPortionByAccount(tem, documentId, actuals[0].document.id);
      let grniTotal = '0';

      const lines: DraftLine[] = [];
      for (const { account, amount } of perAccount.values()) {
        const stockShare = stockByAccount.get(account.id) ?? '0';
        // Never let the split exceed what was actually cut on this account.
        const capped = Money.compare(stockShare, amount) > 0 ? amount : stockShare;
        const expense = Money.subtract(amount, capped);
        if (Money.compare(expense, '0') > 0) {
          lines.push({ account, debit: expense, credit: '0' });
        }
        grniTotal = Money.add(grniTotal, capped);
      }
      if (Money.compare(grniTotal, '0') > 0) {
        const grni = await this.roles.resolve(companyId, AccountRoleType.GRNI, tem);
        lines.push({ account: grni, debit: grniTotal, credit: '0' });
      }

      // Input VAT (recoverable): debit VAT_INPUT for the document's base VAT total, when present.
      const document = await tem.findOne(Document, { id: documentId }, FILTER_OFF);
      const baseTaxTotal = document?.baseTaxTotal ?? '0';
      if (Money.compare(baseTaxTotal, '0') > 0) {
        const vatInput = await this.roles.resolve(companyId, AccountRoleType.VAT_INPUT, tem);
        lines.push({ account: vatInput, debit: baseTaxTotal, credit: '0' });
      }

      await this.appendPaymentTail(tem, companyId, payment, lines);

      await createEntry(tem, {
        company: payment.company,
        instant: payment.paidAt ?? payment.createdAt ?? new Date(),
        sourceType: SOURCE_PAYMENT,
        sourceId: documentId,
        memo: `Settlement of ${document?.docNo ?? documentId}`,
        lines,
      }, this.periods);
      return { companyId, status: GlPostingStatus.POSTED };
    });
  }

  /**
   * Recognise the expense of a fully approved document whose type accrues at approval.
   *
   * Debit the accounts this document's budget cuts name, credit CLAIM_PAYABLE — the liability
   * standing between an approved compensation and the money leaving, the same shape GRNI models
   * between a receipt and its payment. For a compensation the obligation arises at approval and
   * its amount is fixed there; and when the payee is a customer rather than a vendor there is no
   * payment in this system at all, so waiting for `payment.settled` would mean never recognising
   * it. The budget would show the year's claims while the P&L showed nothing.
   *
   * Uses the document's OWN ACTUAL rows, deliberately not the reference-chain walk `postForPayment`
   * needs: a settlement may be posted against an ancestor that holds the reservation, but an
   * accrual belongs to the document that was just approved.
   *
   * Runs off `approval.outcome` after the approval transaction commits, so a chart-of-accounts
   * misconfiguration cannot roll back an approval the approvers already granted.
   */
  async postAccrualForApproval(documentId: string): Promise<void> {
    await this.attempt(
      SOURCE_ACCRUAL,
      documentId,
      () => this.companyOfDocument(documentId),
      () => this.doPostAccrualForApproval(documentId),
    );
  }

  private async doPostAccrualForApproval(documentId: string): Promise<Outcome | null> {
    return this.em.transactional(async (tem) => {
      const document = await tem.findOne(
        Document,
        { id: documentId },
        { ...FILTER_OFF, populate: ['company', 'documentType', 'vendor'] },
      );
      if (!document) return null;
      // Resolved by id rather than read off the populated relation: a DocumentType can come back as
      // an unloaded reference with its flags undefined, which would silently skip every accrual.
      const docType = await tem.findOne(DocumentType, { id: document.documentType.id }, FILTER_OFF);
      // Not an accruing type, so not an accrual source — and no row. `approval.outcome` fires for
      // every completed document in the system; recording a SKIPPED for each would be a row per
      // approval answering a question nobody asks. Reconciliation enumerates accruing types only,
      // so these are never offered as owed either.
      if (!docType?.accruesOnApproval) return null;

      const companyId = document.company.id;
      // A vendor makes this a purchase: trade payable, and the reference-chain rules below.
      // Without one it is a compensation, which keeps every rule it had before.
      const isVendorPurchase = !!document.vendor;
      const existing = await tem.findOne(
        JournalEntry,
        { company: companyId, sourceType: SOURCE_ACCRUAL, sourceId: documentId },
        FILTER_OFF,
      );
      if (existing) return { companyId, status: GlPostingStatus.POSTED };

      // WHICH ACTUAL rows depends on the same distinction.
      //
      // A purchase follows the reference chain, the same walk `postForPayment` makes: `cutBudget`
      // settles the reservation under the RESERVING document, so on a PROC → PO → DISB chain the
      // ACTUAL rows live on the ancestor. A DISB reading only its own rows finds none, logs
      // "skipped", and its payment then falls through to the old expense branch — the accrual would
      // silently do nothing at all, which is the cash-basis behaviour this exists to replace.
      //
      // A compensation keeps reading its OWN rows, deliberately: it has no chain, and its accrual
      // belongs to the document that was approved rather than to whatever it might reference.
      const actuals = isVendorPurchase
        ? await this.settlementActuals(tem, documentId)
        : await tem.find(
            BudgetTxn,
            { document: documentId, txnType: BudgetTxnType.ACTUAL },
            { ...FILTER_OFF, populate: ['budget.account'] },
          );
      if (actuals.length === 0) {
        // Nothing was charged, so there is nothing to recognise. Not an error — and terminal, so
        // this document is never offered as an undelivered posting (design D2).
        this.logger.warn(`Accrual skipped: no ACTUAL budget_txn for document ${documentId}`);
        return { companyId, status: GlPostingStatus.SKIPPED };
      }

      const perAccount = new Map<string, { account: Account; amount: string }>();
      for (const txn of actuals) {
        const account = txn.budget.account;
        if (!account) {
          throw new Error(`Budget ${txn.budget.id} has no account_id; cannot accrue document ${documentId}`);
        }
        const cur = perAccount.get(account.id);
        perAccount.set(account.id, {
          account,
          amount: cur ? Money.add(cur.amount, txn.amount) : txn.amount,
        });
      }

      // Which payable is DERIVED from the document, not configured: an approved obligation to a
      // vendor is trade debt and the document already says so. A `document_type.payable_role`
      // column would ask an administrator to restate that, and every configuration field is one
      // that can be set wrongly — a purchase type quietly crediting CLAIM_PAYABLE would put trade
      // debt in a compensation account with nothing to catch it.
      const payable = await this.roles.resolve(
        companyId,
        isVendorPurchase ? AccountRoleType.ACCOUNTS_PAYABLE : AccountRoleType.CLAIM_PAYABLE,
        tem,
      );
      // For a purchase, the goods already capitalized into INVENTORY at receipt are turned into a
      // vendor debt by the INVOICE, not by the payment — so the stock-tracked share clears GRNI
      // here rather than hitting expense. Same split, same cap, same chained-account fallback as
      // the payment path; only the moment moves. A compensation has no stock.
      const stockByAccount = isVendorPurchase
        ? await this.stockPortionByAccount(tem, documentId, actuals[0].document.id)
        : new Map<string, string>();
      let grniTotal = '0';

      let total = '0';
      const lines: DraftLine[] = [];
      for (const { account, amount } of perAccount.values()) {
        total = Money.add(total, amount);
        const stockShare = stockByAccount.get(account.id) ?? '0';
        const capped = Money.compare(stockShare, amount) > 0 ? amount : stockShare;
        const expense = Money.subtract(amount, capped);
        if (Money.compare(expense, '0') > 0) lines.push({ account, debit: expense, credit: '0' });
        grniTotal = Money.add(grniTotal, capped);
      }
      if (Money.compare(grniTotal, '0') > 0) {
        const grni = await this.roles.resolve(companyId, AccountRoleType.GRNI, tem);
        lines.push({ account: grni, debit: grniTotal, credit: '0' });
      }

      // Input VAT is recognised with the INVOICE: its tax point is the invoice date, so debiting it
      // at payment reports a December invoice paid in January in January's return. The payable is
      // credited gross as a result — the same `base_locked` the payment will clear, which is what is
      // actually owed to the vendor.
      if (isVendorPurchase) {
        const baseTaxTotal = document.baseTaxTotal ?? '0';
        if (Money.compare(baseTaxTotal, '0') > 0) {
          const vatInput = await this.roles.resolve(companyId, AccountRoleType.VAT_INPUT, tem);
          lines.push({ account: vatInput, debit: baseTaxTotal, credit: '0' });
          total = Money.add(total, baseTaxTotal);
        }
      }

      lines.push({ account: payable, debit: '0', credit: total });

      await createEntry(tem, {
        company: document.company,
        instant: document.approvedAt ?? new Date(),
        sourceType: SOURCE_ACCRUAL,
        sourceId: documentId,
        memo: `Accrual of ${document.docNo}`,
        lines,
      }, this.periods);
      return { companyId, status: GlPostingStatus.POSTED };
    });
  }

  /**
   * Clear the payable the accrual raised, when the compensation is actually settled.
   *
   * Debit CLAIM_PAYABLE, credit whatever the settlement type pays out of. Runs INSIDE the caller's
   * transaction, unlike the accrual: the accrual is post-commit because a chart-of-accounts problem
   * must not roll back an approval the approvers already granted, but nothing has been granted here
   * — this is one operator saying "the money left, here is the slip", and a settlement recorded
   * without its ledger effect is worse than one refused, because the operator would believe it was
   * done.
   *
   * The amount comes from the accrual's own credit line rather than being recomputed from
   * `budget_txn`, so the two halves can never disagree about what is owed.
   */
  async postSettlementClearing(
    tem: EntityManager,
    documentId: string,
    settlementType: string,
  ): Promise<void> {
    const document = await tem.findOneOrFail(
      Document,
      { id: documentId },
      { ...FILTER_OFF, populate: ['company'] },
    );
    const companyId = document.company.id;

    const existing = await tem.findOne(
      JournalEntry,
      { company: companyId, sourceType: SOURCE_SETTLEMENT, sourceId: documentId },
      FILTER_OFF,
    );
    if (existing) return;

    const accrual = await tem.findOne(
      JournalEntry,
      { company: companyId, sourceType: SOURCE_ACCRUAL, sourceId: documentId },
      FILTER_OFF,
    );
    if (!accrual) {
      throw new Error(`Document ${documentId} has no accrual entry; there is no payable to clear`);
    }

    const payable = await this.roles.resolve(companyId, AccountRoleType.CLAIM_PAYABLE, tem);
    // The accrued amount is what the accrual credited to the payable.
    const accrualLines = await tem.find(JournalLine, { journalEntry: accrual.id }, FILTER_OFF);
    const owed = accrualLines
      .filter((l) => l.account.id === payable.id)
      .reduce((s, l) => Money.add(s, l.credit), '0');
    if (Money.compare(owed, '0') <= 0) {
      throw new Error(`Accrual for document ${documentId} credited nothing to the payable`);
    }

    const creditRole = SETTLEMENT_CREDIT_ROLE[settlementType];
    if (!creditRole) {
      // Reached only if a type passed validation without a mapping — a coding error, not input.
      throw new Error(`Settlement type '${settlementType}' has no credit account role`);
    }
    const credit = await this.roles.resolve(companyId, creditRole, tem);

    await createEntry(tem, {
      company: document.company,
      instant: new Date(),
      sourceType: SOURCE_SETTLEMENT,
      sourceId: documentId,
      memo: `Settlement of ${document.docNo}`,
      lines: [
        { account: payable, debit: owed, credit: '0' },
        { account: credit, debit: '0', credit: owed },
      ],
    }, this.periods);
    // Recorded on the CALLER's transaction, unlike the three post-commit paths, because this
    // posting shares its fate with the settlement: if the settlement rolls back, so must the row,
    // or it would claim POSTED for an entry that does not exist. It is also why this source can
    // never be owed-and-undelivered, and why the reconciliation pass does not enumerate it.
    await recordOn(tem, companyId, SOURCE_SETTLEMENT, documentId, GlPostingStatus.POSTED);
  }

  /**
   * The ACTUAL budget_txn rows this settlement produced: the paid document's own, or — when the
   * budget hold lives further up the reference chain (PROC→PO→DISB, where only the reserving
   * ancestor holds and is settled) — the nearest ancestor's. Without the walk a chain-settled
   * disbursement finds no ACTUAL and posts nothing to the GL.
   */
  private async settlementActuals(tem: EntityManager, documentId: string): Promise<BudgetTxn[]> {
    const find = (id: string) =>
      tem.find(
        BudgetTxn,
        { document: id, txnType: BudgetTxnType.ACTUAL },
        { ...FILTER_OFF, populate: ['budget.account'] },
      );
    const own = await find(documentId);
    if (own.length) return own;
    const seen = new Set<string>([documentId]);
    let currentId = (
      await tem.findOne(Document, { id: documentId }, { ...FILTER_OFF, populate: ['refDocument'] })
    )?.refDocument?.id;
    while (currentId && !seen.has(currentId)) {
      seen.add(currentId);
      const found = await find(currentId);
      if (found.length) return found;
      const ancestor = await tem.findOne(
        Document,
        { id: currentId },
        { ...FILTER_OFF, populate: ['refDocument'] },
      );
      currentId = ancestor?.refDocument?.id;
    }
    return [];
  }

  /**
   * How much of each budget account's cut on this document represents goods already capitalized
   * into inventory — i.e. the part that clears GRNI instead of hitting expense.
   *
   * Keyed by account id, summed from the document's stock-tracked lines at the budget basis.
   */
  private async stockPortionByAccount(
    tem: EntityManager,
    documentId: string,
    /** The document holding this settlement's ACTUAL rows — its own, or a ref-chain ancestor's. */
    chargedDocumentId?: string,
  ): Promise<Map<string, string>> {
    const lines = await tem.find(
      DocumentLine,
      { document: documentId },
      { ...FILTER_OFF, populate: ['item', 'budget.account'] },
    );
    // A settlement type is ordinarily NOT budget-controlled, so `resolveLineGlAndBudget` stamps no
    // budget on its lines and only the document that reserved carries one. Without the fallback
    // below every chained purchase resolves no account, the portion is nothing, and the whole
    // amount debits expense — putting the goods through profit and loss twice and leaving the GRNI
    // raised at receipt never cleared.
    //
    // The fallback reads the lines of `chargedDocumentId` — the document `settlementActuals`
    // already resolved as the one holding this settlement's ACTUAL rows. Reusing its answer rather
    // than walking `ref_document_id` a second time is what makes the two sides agree by
    // construction: the accounts here are the accounts `perAccount` is keyed by, because they come
    // from the same document. A second, independent walk could in principle land elsewhere, and the
    // spec requires the stock figure and the cut to agree, not to currently match.
    //
    // Matching by `line_no` is safe because `create-from` copies a chain 1:1 with `line_no`
    // preserved — the same assumption `cutBudget` already settles a chained document through, so a
    // chain that broke it would strand the reservation as RESERVE long before the GL saw it.
    let fallbackByLine: Map<number, Account> | undefined;

    const byAccount = new Map<string, string>();
    for (const line of lines) {
      if (!line.item?.isStockTracked) continue;
      let account = line.budget?.account;
      if (!account && chargedDocumentId && chargedDocumentId !== documentId) {
        fallbackByLine ??= await this.accountByLineOf(tem, chargedDocumentId);
        account = fallbackByLine.get(line.lineNo);
      }
      const amount = line.budgetBaseLineAmount;
      if (!account || !amount) continue;
      byAccount.set(account.id, Money.add(byAccount.get(account.id) ?? '0', amount));
    }
    return byAccount;
  }

  /**
   * The budget account behind each of one document's lines, keyed by `line_no`.
   *
   * The ACCOUNT comes from that line's budget, deliberately not from the item's
   * `default_gl_account`. The item route lands on the same account today — that GL is how the
   * budget was resolved in the first place — but re-deriving it means an item whose default GL is
   * edited after its predecessor was approved would clear a different account than the budget was
   * cut on, silently, with the entry still balancing.
   */
  /**
   * The payable an approval accrual raised for this document, if it raised one.
   *
   * Read off the accrual's own credit line rather than recomputed from `base_locked`: the entry IS
   * the record of what was raised, and a recomputation would be a second derivation of a number
   * already written down — free to disagree with it the day either formula moves.
   *
   * Returns null when the document was never accrued, which is what sends `postForPayment` down its
   * original path.
   */
  private async accruedPayable(
    tem: EntityManager,
    companyId: string,
    documentId: string,
  ): Promise<{ account: Account; amount: string } | null> {
    const accrual = await tem.findOne(
      JournalEntry,
      { company: companyId, sourceType: SOURCE_ACCRUAL, sourceId: documentId },
      FILTER_OFF,
    );
    if (!accrual) return null;

    const lines = await tem.find(
      JournalLine,
      { journalEntry: accrual.id },
      { ...FILTER_OFF, populate: ['account'] },
    );
    // The payable is the credit side of an accrual: its debits are expense, VAT and GRNI.
    const credits = lines.filter((l) => Money.compare(l.credit, '0') > 0);
    if (!credits.length) {
      throw new Error(`Accrual for document ${documentId} credited nothing to clear`);
    }
    const account = credits[0].account;
    const amount = credits.reduce((s, l) => Money.add(s, l.credit), '0');
    return { account, amount };
  }

  /**
   * The cash side every payment entry ends with, whichever debit preceded it: WHT withheld, cash
   * paid net of it, and the FX difference. Identical in both branches because it does not care
   * what was debited — only what left the bank.
   */
  private async appendPaymentTail(
    tem: EntityManager,
    companyId: string,
    payment: Payment,
    lines: DraftLine[],
  ): Promise<void> {
    // Withholding tax: credit WHT_PAYABLE for the withheld amount, when present.
    const whtAmount = payment.whtAmount ?? '0';
    if (Money.compare(whtAmount, '0') > 0) {
      const whtPayable = await this.roles.resolve(companyId, AccountRoleType.WHT_PAYABLE, tem);
      lines.push({ account: whtPayable, debit: '0', credit: whtAmount });
    }

    // Credit cash-clearing at the actual base paid, net of any WHT withheld.
    const cash = await this.roles.resolve(companyId, AccountRoleType.CASH_CLEARING, tem);
    lines.push({ account: cash, debit: '0', credit: Money.subtract(payment.baseActual, whtAmount) });

    // FX difference (base_actual − base_locked): LOSS → debit FX_LOSS; GAIN → credit FX_GAIN.
    const cmp = Money.compare(payment.fxDelta, '0');
    if (cmp > 0) {
      const fxLoss = await this.roles.resolve(companyId, AccountRoleType.FX_LOSS, tem);
      lines.push({ account: fxLoss, debit: payment.fxDelta, credit: '0' });
    } else if (cmp < 0) {
      const fxGain = await this.roles.resolve(companyId, AccountRoleType.FX_GAIN, tem);
      lines.push({ account: fxGain, debit: '0', credit: Money.subtract('0', payment.fxDelta) });
    }
  }

  private accountByLineOf = accountByLineOf;

  /**
   * Post one balanced entry for a stock movement that changed value.
   *
   * Idempotent on `(company, 'STOCK_TXN', stockTxnId)`, reusing the same key the payment path
   * uses, so a retry never double-posts. RESERVE and RELEASE never reach here — they move
   * availability, not value.
   *
   * A missing or inactive `account_role` mapping raises, and the caller logs it without rolling
   * back the movement: stock stays correct while the GL is visibly incomplete, which is the
   * failure mode operators already know from payment posting.
   */
  async postForStockTxn(stockTxnId: string): Promise<void> {
    await this.attempt(
      SOURCE_STOCK,
      stockTxnId,
      () => this.companyOfStockTxn(stockTxnId),
      () => this.doPostForStockTxn(stockTxnId),
    );
  }

  private async doPostForStockTxn(stockTxnId: string): Promise<Outcome | null> {
    return this.em.transactional(async (tem) => {
      const txn = await tem.findOne(
        StockTxn,
        { id: stockTxnId },
        { ...FILTER_OFF, populate: ['company', 'item', 'warehouse'] },
      );
      if (!txn) {
        // No row, so no company to file an outcome against and nothing that could be owed.
        this.logger.warn(`GL posting skipped: stock_txn ${stockTxnId} not found`);
        return null;
      }
      const companyId = txn.company.id;

      const existing = await tem.findOne(
        JournalEntry,
        { company: companyId, sourceType: SOURCE_STOCK, sourceId: stockTxnId },
        FILTER_OFF,
      );
      if (existing) return { companyId, status: GlPostingStatus.POSTED };

      const lines = await this.stockEntryLines(tem, txn, companyId);
      // Nothing to post — a RESERVE or RELEASE moved no value, or a transfer's two ends resolve to
      // the same INVENTORY account. Terminal, so the sweep never offers these again (design D2).
      if (!lines) return { companyId, status: GlPostingStatus.SKIPPED };

      await createEntry(tem, {
        company: txn.company,
        instant: txn.createdAt ?? new Date(),
        sourceType: SOURCE_STOCK,
        sourceId: stockTxnId,
        memo: `${txn.txnType} ${txn.qty} ${txn.item.itemCode} @ ${txn.warehouse.code}`,
        lines,
      }, this.periods);
      return { companyId, status: GlPostingStatus.POSTED };
    });
  }

  /**
   * The two sides of a stock movement's entry, or null when there is nothing to post.
   *
   * The value is `qty × unit_cost` rounded to the posted-amount scale. Cost is carried at six
   * decimals precisely so this rounding happens once, here, rather than accumulating upstream.
   */
  private async stockEntryLines(
    tem: EntityManager,
    txn: StockTxn,
    companyId: string,
  ): Promise<DraftLine[] | null> {
    const value = Money.round(Money.multiply(txn.qty, txn.unitCost ?? '0'), VALUE_DP);
    if (Money.compare(value, '0') === 0) return null;

    const inventory = await this.roles.resolve(companyId, AccountRoleType.INVENTORY, tem);

    switch (txn.txnType) {
      case StockTxnType.RECEIVE: {
        // Goods arrived but no invoice has been booked yet: the asset is real, the liability is
        // the promise to pay for it.
        const grni = await this.roles.resolve(companyId, AccountRoleType.GRNI, tem);
        return [
          { account: inventory, debit: value, credit: '0' },
          { account: grni, debit: '0', credit: value },
        ];
      }
      case StockTxnType.ISSUE: {
        // The one place a stock-tracked purchase becomes an expense.
        const expense = await this.issueExpenseAccount(tem, txn, companyId);
        return [
          { account: expense, debit: value, credit: '0' },
          { account: inventory, debit: '0', credit: value },
        ];
      }
      case StockTxnType.ADJUST_INCREASE: {
        const adj = await this.roles.resolve(companyId, AccountRoleType.INVENTORY_ADJUSTMENT, tem);
        return [
          { account: inventory, debit: value, credit: '0' },
          { account: adj, debit: '0', credit: value },
        ];
      }
      case StockTxnType.ADJUST_DECREASE: {
        const adj = await this.roles.resolve(companyId, AccountRoleType.INVENTORY_ADJUSTMENT, tem);
        return [
          { account: adj, debit: value, credit: '0' },
          { account: inventory, debit: '0', credit: value },
        ];
      }
      case StockTxnType.TRANSFER_OUT:
      case StockTxnType.TRANSFER_IN:
        // Both warehouses map to the same company INVENTORY account, so a transfer nets to zero
        // in the GL. Posting a debit and credit to one account would be noise, not information —
        // the stock ledger already records that the goods moved.
        return null;
      default:
        return null; // RESERVE / RELEASE move availability, not value
    }
  }

  /**
   * Where an issue's cost lands: the item's per-company GL (`item_company.default_gl_account`).
   *
   * Per company, not group-wide, because the same item may be a different expense in each
   * company's chart — which is exactly why that column lives on `item_company`.
   */
  private async issueExpenseAccount(
    tem: EntityManager,
    txn: StockTxn,
    companyId: string,
  ): Promise<Account> {
    const enablement = await tem.findOne(
      ItemCompany,
      { item: txn.item.id, company: companyId },
      FILTER_OFF,
    );
    if (!enablement?.defaultGlAccount) {
      throw new Error(
        `Item ${txn.item.itemCode} has no default_gl_account for company ${companyId}; cannot post its issue`,
      );
    }
    return this.accounts.resolvePostable(enablement.defaultGlAccount, companyId);
  }
}
