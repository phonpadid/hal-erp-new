import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { AccountRoleType, BudgetTxnType, StockTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { Account } from '../accounting/accounting.entities';
import { BudgetTxn } from '../budget/budget.entities';
import { Document, DocumentLine, DocumentType } from '../document/document.entities';
import { StockTxn } from '../inventory/inventory.entities';
import { ItemCompany } from '../master-data/master-data.entities';
import { AccountService } from '../accounting/account.service';
import { Company } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AccountRoleService } from './account-role.service';
import { JournalEntry, JournalLine } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;
const SOURCE_PAYMENT = 'PAYMENT';
// Distinct from SOURCE_PAYMENT on purpose: one document may carry both an accrual and, later, a
// settlement entry, and journal_entry is unique per (company, source_type, source_id).
const SOURCE_ACCRUAL = 'APPROVAL_ACCRUAL';
const SOURCE_STOCK = 'STOCK_TXN';
/** Posted-amount scale. Inventory cost is carried at 6 dp; GL amounts round to the currency's. */
const VALUE_DP = 2;

interface DraftLine {
  account: Account;
  debit: string;
  credit: string;
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
  ) {}

  /**
   * Build and persist the entry for a settled document, atomically. Reads the payment
   * (base amounts + FX) and the document's budget_txn ACTUAL rows (→ expense accounts).
   * Debit each expense account at the locked base, credit cash-clearing at the actual base,
   * and post the FX delta to the realized FX gain/loss account.
   */
  async postForPayment(documentId: string): Promise<void> {
    await this.em.transactional(async (tem) => {
      const payment = await tem.findOne(
        Payment,
        { document: documentId },
        { ...FILTER_OFF, populate: ['company'] },
      );
      if (!payment) {
        this.logger.warn(`GL posting skipped: no payment for document ${documentId}`);
        return;
      }
      const companyId = payment.company.id;

      // Idempotency: one entry per source document per company.
      const existing = await tem.findOne(
        JournalEntry,
        { company: companyId, sourceType: SOURCE_PAYMENT, sourceId: documentId },
        FILTER_OFF,
      );
      if (existing) return;

      // Expense side: sum the ACTUAL cuts per budget account (locked basis). The settlement may
      // have been posted against a ref-chain ancestor rather than this document — a chain holds
      // ONE reservation and PostActionService settles the holder — so follow the same chain here.
      const actuals = await this.settlementActuals(tem, documentId);
      if (actuals.length === 0) {
        this.logger.warn(`GL posting skipped: no ACTUAL budget_txn for document ${documentId}`);
        return;
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
      const stockByAccount = await this.stockPortionByAccount(tem, documentId);
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

      // Balanced-entry invariant: Σdebit MUST equal Σcredit.
      const totalDebit = lines.reduce((s, l) => Money.add(s, l.debit), '0');
      const totalCredit = lines.reduce((s, l) => Money.add(s, l.credit), '0');
      if (Money.compare(totalDebit, totalCredit) !== 0) {
        throw new Error(`Unbalanced journal entry for document ${documentId}: debit ${totalDebit} != credit ${totalCredit}`);
      }

      const entry = tem.create(JournalEntry, {
        company: tem.getReference(Company, companyId),
        entryDate: (payment.paidAt ?? payment.createdAt ?? new Date()).toISOString().slice(0, 10),
        sourceType: SOURCE_PAYMENT,
        sourceId: documentId,
        memo: `Settlement of ${document?.docNo ?? documentId}`,
        createdAt: new Date(),
      });
      tem.persist(entry);
      for (const l of lines) {
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
    await this.em.transactional(async (tem) => {
      const document = await tem.findOne(
        Document,
        { id: documentId },
        { ...FILTER_OFF, populate: ['company', 'documentType'] },
      );
      if (!document) return;
      // Resolved by id rather than read off the populated relation: a DocumentType can come back as
      // an unloaded reference with its flags undefined, which would silently skip every accrual.
      const docType = await tem.findOne(DocumentType, { id: document.documentType.id }, FILTER_OFF);
      if (!docType?.accruesOnApproval) return; // not an accruing type — nothing to recognise

      const companyId = document.company.id;
      const existing = await tem.findOne(
        JournalEntry,
        { company: companyId, sourceType: SOURCE_ACCRUAL, sourceId: documentId },
        FILTER_OFF,
      );
      if (existing) return;

      const actuals = await tem.find(
        BudgetTxn,
        { document: documentId, txnType: BudgetTxnType.ACTUAL },
        { ...FILTER_OFF, populate: ['budget.account'] },
      );
      if (actuals.length === 0) {
        // Nothing was charged, so there is nothing to recognise. Not an error.
        this.logger.warn(`Accrual skipped: no ACTUAL budget_txn for document ${documentId}`);
        return;
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

      const payable = await this.roles.resolve(companyId, AccountRoleType.CLAIM_PAYABLE, tem);
      let total = '0';
      const entry = tem.create(JournalEntry, {
        company: tem.getReference(Company, companyId),
        entryDate: (document.approvedAt ?? new Date()).toISOString().slice(0, 10),
        sourceType: SOURCE_ACCRUAL,
        sourceId: documentId,
        memo: `Accrual of ${document.docNo}`,
        createdAt: new Date(),
      });
      tem.persist(entry);
      for (const { account, amount } of perAccount.values()) {
        total = Money.add(total, amount);
        tem.persist(
          tem.create(JournalLine, {
            company: tem.getReference(Company, companyId),
            journalEntry: entry,
            account: tem.getReference(Account, account.id),
            debit: amount,
            credit: '0',
          }),
        );
      }
      tem.persist(
        tem.create(JournalLine, {
          company: tem.getReference(Company, companyId),
          journalEntry: entry,
          account: tem.getReference(Account, payable.id),
          debit: '0',
          credit: total,
        }),
      );
    });
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
  ): Promise<Map<string, string>> {
    const lines = await tem.find(
      DocumentLine,
      { document: documentId },
      { ...FILTER_OFF, populate: ['item', 'budget.account'] },
    );
    const byAccount = new Map<string, string>();
    for (const line of lines) {
      if (!line.item?.isStockTracked) continue;
      const accountId = line.budget?.account?.id;
      const amount = line.budgetBaseLineAmount;
      if (!accountId || !amount) continue;
      byAccount.set(accountId, Money.add(byAccount.get(accountId) ?? '0', amount));
    }
    return byAccount;
  }

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
    await this.em.transactional(async (tem) => {
      const txn = await tem.findOne(
        StockTxn,
        { id: stockTxnId },
        { ...FILTER_OFF, populate: ['company', 'item', 'warehouse'] },
      );
      if (!txn) {
        this.logger.warn(`GL posting skipped: stock_txn ${stockTxnId} not found`);
        return;
      }
      const companyId = txn.company.id;

      const existing = await tem.findOne(
        JournalEntry,
        { company: companyId, sourceType: SOURCE_STOCK, sourceId: stockTxnId },
        FILTER_OFF,
      );
      if (existing) return;

      const lines = await this.stockEntryLines(tem, txn, companyId);
      if (!lines) return; // nothing to post (no value moved, or a same-account transfer)

      const totalDebit = lines.reduce((s, l) => Money.add(s, l.debit), '0');
      const totalCredit = lines.reduce((s, l) => Money.add(s, l.credit), '0');
      if (Money.compare(totalDebit, totalCredit) !== 0) {
        throw new Error(
          `Unbalanced stock entry for ${stockTxnId}: debit ${totalDebit} != credit ${totalCredit}`,
        );
      }

      const entry = tem.create(JournalEntry, {
        company: tem.getReference(Company, companyId),
        entryDate: (txn.createdAt ?? new Date()).toISOString().slice(0, 10),
        sourceType: SOURCE_STOCK,
        sourceId: stockTxnId,
        memo: `${txn.txnType} ${txn.qty} ${txn.item.itemCode} @ ${txn.warehouse.code}`,
        createdAt: new Date(),
      });
      tem.persist(entry);
      for (const l of lines) {
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
