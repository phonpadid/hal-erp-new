import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { ApproveAction, DocStatus } from '../../common/enums';
import { inTransaction } from '../../common/uow/unit-of-work';
import { Money } from '../../common/money/money';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApprovalLog, DocumentApprovalStep, ROUTE_STEP_STATUS } from '../approval/approval.entities';
import { BudgetLedgerService, type ReserveLine } from '../budget/budget-ledger.service';
import { ExchangeRateService } from '../currency/exchange-rate.service';
import { Company } from '../multi-company/multi-company.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Document, DocumentLine } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** What a restatement did, for the caller to report. */
export interface RestatedRate {
  documentId: string;
  from: string;
  to: string;
  /** False when the stated rate was the one the document already carried; nothing was written. */
  changed: boolean;
  baseTotalAmount: string;
  /** Whether the budget hold moved. False when a `BUDGET_RATE` insulates the budget basis. */
  budgetReReserved: boolean;
}

/**
 * Restating a document's exchange rate: the correction the person who actually converted the money
 * makes, while the document can still be refused.
 *
 * The rate a document carries is resolved once at submit from the company-wide rate table as of that
 * day. That is the right default and the wrong final answer: this business pays BEFORE the document
 * finishes approving, so the person who knows what the bank gave them learns it after the figure is
 * already stamped, and their only other lever — editing the rate table — moves every other document
 * with it. So one document's rate can be restated by a person, and only while somebody can still
 * say no to the result.
 *
 * That last clause is what keeps invariant 6 meaningful. "Never recomputed" narrows to "never
 * recomputed FROM CURRENT RATES, and restated only by a person, only while an approval remains". A
 * rate recomputed from a table changes documents nobody is looking at, in bulk, silently; a rate
 * restated here changes one document, is attributed to the person who changed it, and still has to
 * survive an approval nobody has given yet.
 */
@Injectable()
export class DocumentRateService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
    private readonly exchangeRates: ExchangeRateService,
    private readonly budget: BudgetLedgerService,
  ) {}

  /**
   * Restate `documentId`'s rate, moving its base amounts and its budget hold to match.
   *
   * One transaction. The budget's control-point locks are taken by `releaseAll` and held to commit,
   * so the release and the re-reserve cannot be interleaved by another document's submit taking the
   * room this one is about to need — the two would otherwise both pass a ceiling check neither
   * would pass second.
   */
  async restate(documentId: string, rate: string): Promise<RestatedRate> {
    if (Money.compare(rate, '0') <= 0) throw new BadRequestException('rate must be positive');
    const companyId = RequestContext.companyId()!;
    const userId = RequestContext.userId()!;

    // Refused before anything is written, and each refusal names its own reason: the screen has to
    // be able to explain why the control is gone, not merely that it is.
    const document = await this.assertRestatable(documentId, companyId);
    if (Money.compare(document.exchangeRate ?? '1', rate) === 0) {
      // Nothing to do, and saying so beats writing a RELEASE/RESERVE pair and a log row that record
      // a change of zero — the trail should carry what happened, not what was clicked.
      return {
        documentId,
        from: document.exchangeRate ?? '1',
        to: rate,
        changed: false,
        baseTotalAmount: document.baseTotalAmount ?? '0',
        budgetReReserved: false,
      };
    }

    return inTransaction(this.em, async (tem) => {
      // Re-read inside the transaction. `assertRestatable` answered a moment ago; this catches the
      // instant between — the last approval landing, or a payment being recorded, while we queued.
      const doc = await this.assertRestatable(documentId, companyId, tem);
      const from = doc.exchangeRate ?? '1';

      const company = await tem.findOne(
        Company,
        { id: companyId },
        { ...FILTER_OFF, populate: ['baseCurrency'] },
      );
      const dp = company?.baseCurrency?.decimalPlaces ?? 2;
      const toBase = (amount: string) => Money.round(Money.multiply(amount, rate), dp);

      const lines = await tem.find(
        DocumentLine,
        { document: documentId },
        { ...FILTER_OFF, populate: ['budget'] },
      );

      // The daily basis always follows the stated rate: it is the document's own worth and the
      // basis the payment's FX is measured against.
      doc.exchangeRate = rate;
      doc.baseTotalAmount = toBase(doc.grandTotal ?? doc.totalAmount ?? '0');
      doc.baseTaxTotal = toBase(doc.taxTotal ?? '0');
      for (const l of lines) l.baseLineAmount = toBase(l.lineAmount);

      // The BUDGET basis follows only when nothing else governs it. Decided exactly as the submit
      // path decides it, so restating can never change WHICH rate governs a document's budget —
      // only what that rate says.
      const budgetRate = await this.budgetRateFor(doc, company, rate);
      const budgetReReserved = budgetRate !== null;
      if (budgetRate !== null) {
        const budgetToBase = (amount: string) => Money.round(Money.multiply(amount, budgetRate), dp);
        // Tax-inclusive, exactly as submit stamps it. The tax a line carries was already computed
        // and stamped at submit, so restating re-converts the same amounts at a different rate and
        // invents nothing: a document corrected mid-approval and one submitted at the corrected rate
        // reserve the same figure, which is the only way two paths to one document can agree.
        const taxInclusive = (l: DocumentLine) => Money.add(l.lineAmount, l.taxAmount ?? '0');
        doc.budgetExchangeRate = budgetRate;
        doc.budgetBaseTotalAmount = budgetToBase(doc.grandTotal ?? doc.totalAmount ?? '0');
        for (const l of lines) l.budgetBaseLineAmount = budgetToBase(taxInclusive(l));

        // Built from the same source submit reserved from — the document's own lines — so a
        // document re-reserves exactly what it would have reserved had it been submitted at this
        // rate, and one that reserved nothing re-reserves nothing.
        const reserveLines: ReserveLine[] = lines
          .filter((l) => l.budget)
          .map((l) => ({ budgetId: l.budget!.id, baseAmount: budgetToBase(taxInclusive(l)) }));

        // Release first, then take the new hold, both under the locks `releaseAll` acquires and
        // Postgres holds to commit. Append-only throughout: a RELEASE row and a RESERVE row, never
        // an update (invariant 2). `reserve` runs coverage and the over-limit policy unchanged, so
        // a restatement past a HARD_STOP ceiling is refused by the code that refuses a submit — and
        // that refusal rolls this whole transaction back, leaving the original hold untouched.
        await this.budget.releaseAll(documentId, tem);
        if (reserveLines.length) await this.budget.reserve(documentId, reserveLines, tem);
      }

      // The trail. `step_no` is the step the document is waiting on, so the row reads in order
      // against the route, between the approvals it happened between.
      tem.create(ApprovalLog, {
        document: tem.getReference(Document, documentId),
        stepNo: doc.currentStepNo,
        approver: tem.getReference(AppUser, userId),
        action: ApproveAction.RESTATE_RATE,
        remark: `Exchange rate restated ${from} → ${rate}`,
        actedAt: new Date(),
      });

      await tem.flush();
      return {
        documentId,
        from,
        to: rate,
        changed: true,
        baseTotalAmount: doc.baseTotalAmount,
        budgetReReserved,
      };
    });
  }

  /**
   * The rate the BUDGET basis should now use, or null when the budget basis must not move.
   *
   * A configured `BUDGET_RATE` exists precisely so daily FX does not whipsaw budget control and the
   * approval bands that read the same basis. Where one exists the budget is insulated and a
   * restatement leaves the hold exactly where it is. Where none exists the budget basis has been
   * tracking the daily rate since submit, and it keeps tracking it.
   */
  private async budgetRateFor(
    doc: Document,
    company: Company | null,
    rate: string,
  ): Promise<string | null> {
    const baseCode = company?.baseCurrency?.code;
    const docCode = doc.currency?.code ?? baseCode;
    if (!baseCode || !docCode) return rate;
    try {
      await this.exchangeRates.resolveRate({
        from: docCode,
        to: baseCode,
        asOf: new Date().toISOString().slice(0, 10),
        companyId: doc.company.id,
        rateType: 'BUDGET_RATE',
      });
      return null; // a budget rate governs; the hold does not move
    } catch {
      return rate; // no budget rate configured — the budget basis follows the daily one
    }
  }

  /**
   * Every reason a rate may not be restated, each refused by name.
   *
   * Somebody must still be able to refuse the figure. A document past its last approval has spent
   * its signatures on a number, and a paid one has spent the money — neither can be quietly made
   * worth something else.
   */
  private async assertRestatable(
    documentId: string,
    companyId: string,
    tem?: EntityManager,
  ): Promise<Document> {
    const em = tem ?? this.scope.forActiveCompany();
    const doc = await em.findOne(
      Document,
      { id: documentId },
      { ...FILTER_OFF, populate: ['company', 'currency'] },
    );
    if (!doc || doc.company.id !== companyId) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
    if (doc.status !== DocStatus.IN_APPROVAL) {
      throw new BadRequestException(
        `Document ${doc.docNo} is ${doc.status}; its rate can only be restated while it is in approval`,
      );
    }
    if (await em.findOne(Payment, { document: documentId }, FILTER_OFF)) {
      throw new BadRequestException(
        `Document ${doc.docNo} already has a recorded payment; its rate can no longer be restated`,
      );
    }
    const undecided = await em.count(
      DocumentApprovalStep,
      { document: documentId, status: ROUTE_STEP_STATUS.PENDING, supersededAt: null },
      FILTER_OFF,
    );
    if (undecided === 0) {
      throw new BadRequestException(
        `Document ${doc.docNo} has no approval step left to decide; its rate can no longer be restated ` +
          'because nobody would be signing the changed figure',
      );
    }
    return doc;
  }
}
