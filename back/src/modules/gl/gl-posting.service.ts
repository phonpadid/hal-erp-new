import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { AccountRoleType, BudgetTxnType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { Account } from '../accounting/accounting.entities';
import { BudgetTxn } from '../budget/budget.entities';
import { Document } from '../document/document.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AccountRoleService } from './account-role.service';
import { JournalEntry, JournalLine } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;
const SOURCE_PAYMENT = 'PAYMENT';

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

      // Expense side: sum the document's ACTUAL cuts per budget account (locked basis).
      const actuals = await tem.find(
        BudgetTxn,
        { document: documentId, txnType: BudgetTxnType.ACTUAL },
        { ...FILTER_OFF, populate: ['budget.account'] },
      );
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

      const lines: DraftLine[] = [];
      for (const { account, amount } of perAccount.values()) {
        lines.push({ account, debit: amount, credit: '0' });
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
}
