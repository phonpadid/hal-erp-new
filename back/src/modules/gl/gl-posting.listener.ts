import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GlPostingService } from './gl-posting.service';

interface PaymentSettledEvent {
  documentId: string;
  fxDelta: string;
  fxKind: string;
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
}
