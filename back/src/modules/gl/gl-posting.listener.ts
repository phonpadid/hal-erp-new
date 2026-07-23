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
}
