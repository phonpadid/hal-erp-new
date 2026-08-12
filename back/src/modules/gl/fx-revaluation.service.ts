import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { AccountRoleType } from '../../common/enums';
import { Money } from '../../common/money/money';
import { Document } from '../document/document.entities';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { Company } from '../multi-company/multi-company.entities';
import { SOURCE_ACCRUAL, SOURCE_PAYMENT } from './gl-posting.service';
import { AccountRole, JournalEntry } from './gl.entities';

const FILTER_OFF = { filters: { company: false } } as const;

export interface PayableRevaluation {
  documentId: string;
  documentNo: string | null;
  currency: string;
  /** The document's own-currency gross — what is actually owed to the supplier. */
  foreignAmount: string;
  /** What the payable is carried at: the amount the accrual credited. */
  carriedAmount: string;
  /** The same foreign amount at the closing rate. */
  revaluedAmount: string;
  /** Positive when the liability GREW, which is a loss. */
  difference: string;
}

/**
 * Retranslating foreign-currency payables at a reporting date.
 *
 * A payable is carried at the rate stamped on its document at submit, and that rate is deliberately
 * never recomputed (invariant 6) — right for the budget and the approval it passed, wrong for the
 * balance sheet. A supplier owed 1,000 USD in March at 34 is reported at 34,000 in December when it
 * costs 35,000 to pay them, and the difference surfaces only when the payment settles, in a period
 * that has nothing to do with when the currency moved.
 *
 * No new table is needed: `document` already carries its currency, its locked rate and its
 * own-currency total, and the payable is derived from the accrual that names the document.
 */
@Injectable()
export class FxRevaluationService {
  constructor(
    private readonly em: EntityManager,
    private readonly rates: ExchangeRateService,
  ) {}

  /**
   * Each open payable whose document is in a foreign currency, with what it is carried at and what
   * it is worth at the closing rate.
   *
   * "Open" is the derivation `JournalService.openPayables` states: an approval accrual crediting
   * `ACCOUNTS_PAYABLE` with no payment entry for the same source. Written once there and read the
   * same way here rather than re-derived, so the two cannot disagree about what is owed.
   *
   * A missing rate is NOT swallowed. `resolveRate` throws naming the pair and the date, and that
   * refusal propagates to the close: falling back to the locked rate would revalue nothing while
   * appearing to, and skipping the payable would understate the liability silently.
   */
  async outstanding(companyId: string, asOf: string): Promise<PayableRevaluation[]> {
    const em = this.em.fork();
    const company = await em.findOneOrFail(
      Company, { id: companyId }, { ...FILTER_OFF, populate: ['baseCurrency'] },
    );
    // A company with no base currency has nothing to retranslate INTO, and the posting engine would
    // have refused long before this.
    const baseCode = company.baseCurrency?.code;
    if (!baseCode) return [];

    const apRole = await em.findOne(
      AccountRole,
      { company: companyId, role: AccountRoleType.ACCOUNTS_PAYABLE },
      { ...FILTER_OFF, populate: ['account'] },
    );
    if (!apRole) return [];

    const accruals = await em.find(
      JournalEntry,
      { company: companyId, sourceType: SOURCE_ACCRUAL },
      { ...FILTER_OFF, populate: ['lines', 'lines.account'], orderBy: { entryDate: 'ASC' } },
    );
    if (!accruals.length) return [];

    const sourceIds = accruals.map((a) => a.sourceId);
    const paid = new Set(
      (
        await em.find(
          JournalEntry,
          { company: companyId, sourceType: SOURCE_PAYMENT, sourceId: { $in: sourceIds } },
          FILTER_OFF,
        )
      ).map((e) => e.sourceId),
    );
    const documents = new Map(
      (await em.find(Document, { id: { $in: sourceIds } }, { ...FILTER_OFF, populate: ['currency'] }))
        .map((d) => [d.id, d]),
    );

    const out: PayableRevaluation[] = [];
    for (const accrual of accruals) {
      if (paid.has(accrual.sourceId)) continue;
      const document = documents.get(accrual.sourceId);
      // Base-currency payables have nothing to retranslate; including them would post a difference
      // of zero for every domestic supplier and make the entry unreadable.
      const currency = document?.currency?.code;
      if (!currency || currency === baseCode) continue;

      const carried = accrual.lines
        .getItems()
        .filter((l) => l.account.id === apRole.account.id)
        .reduce((s, l) => Money.add(s, l.credit), '0');
      // A CLAIM_PAYABLE accrual credits a different account, so it contributes nothing and drops
      // out here without a second rule.
      if (Money.compare(carried, '0') <= 0) continue;

      const foreignAmount = document.grandTotal ?? document.totalAmount ?? '0';
      const { rate } = await this.rates.resolveRate({
        from: currency,
        to: baseCode,
        asOf,
        companyId,
      });
      const revalued = Money.round(Money.multiply(foreignAmount, rate), 2);

      out.push({
        documentId: accrual.sourceId,
        documentNo: document.docNo ?? null,
        currency,
        foreignAmount,
        carriedAmount: carried,
        revaluedAmount: revalued,
        // Positive when the liability GREW. A bigger liability is a LOSS — the intuition that a
        // bigger number is better runs the wrong way here, and a sign error is invisible in an
        // entry that still balances.
        difference: Money.subtract(revalued, carried),
      });
    }
    return out;
  }
}
