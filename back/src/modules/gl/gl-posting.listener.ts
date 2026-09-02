import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GlPostingService } from './gl-posting.service';

interface PaymentSettledEvent {
  documentId: string;
  fxDelta: string;
  fxKind: string;
}

interface StockMovedEvent {
  /** The stock_txn rows the approved movement wrote. */
  stockTxnIds: string[];
}

interface ApprovalOutcomeEvent {
  documentId: string;
  /** `COMPLETED` is the terminal status of a fully approved document; `APPROVED` is transient. */
  status: string;
}

/**
 * Posts a GL journal entry when a disbursement settles. Runs post-commit off `payment.settled`;
 * a posting failure is logged and never propagated into the (already committed) payment flow.
 * The idempotency key on `journal_entry` makes a retry safe.
 */
@Injectable()
export class GlPostingListener {
  private readonly logger = new Logger(GlPostingListener.name);

  constructor(private readonly posting: GlPostingService) {}

  @OnEvent('payment.settled')
  async onPaymentSettled(e: PaymentSettledEvent): Promise<void> {
    try {
      await this.posting.postForPayment(e.documentId);
    } catch (err) {
      this.logger.error(`GL posting failed for document ${e.documentId}: ${(err as Error).message}`);
    }
  }

  /**
   * Posts each stock movement of an approved document. Runs post-commit, so a posting failure
   * leaves the stock movement itself intact — stock stays correct while the GL is visibly
   * incomplete, the same contract payment posting already has. Each row is posted independently
   * so one unmappable item cannot suppress the rest.
   */
  @OnEvent('stock.moved')
  async onStockMoved(e: StockMovedEvent): Promise<void> {
    for (const id of e.stockTxnIds) {
      try {
        await this.posting.postForStockTxn(id);
      } catch (err) {
        this.logger.error(`GL posting failed for stock_txn ${id}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Recognises the expense of a fully approved document whose type accrues at approval.
   *
   * Filters to the outcome that means "fully approved" and lets the service decide whether the
   * type accrues, the same way the other consumers of this event filter to their own documents.
   * Post-commit and non-propagating for the reason the whole file is: a chart-of-accounts problem
   * must not disturb an approval the approvers already granted. The failure is logged loudly,
   * because an accrual that silently did not happen is a hole in the books nobody can see.
   */
  @OnEvent('approval.outcome')
  async onApprovalOutcome(e: ApprovalOutcomeEvent): Promise<void> {
    if (e.status !== 'COMPLETED') return;
    try {
      await this.posting.postAccrualForApproval(e.documentId);
    } catch (err) {
      this.logger.error(`GL accrual failed for document ${e.documentId}: ${(err as Error).message}`);
    }
  }
}
