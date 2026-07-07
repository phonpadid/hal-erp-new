import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

interface PaymentReadyEvent {
  documentId: string;
}

interface PaymentSettledEvent {
  documentId: string;
  fxDelta: string;
  fxKind: string;
}

/**
 * Consumes payment events. A dispatch seam: today it logs; an external accounting integration
 * can hook in here without touching the approval/payment flow. `payment.ready` fires when a
 * CUT_BUDGET document settles; `payment.settled` fires when an actual payment + FX is recorded.
 */
@Injectable()
export class PaymentHandoffListener {
  private readonly logger = new Logger(PaymentHandoffListener.name);

  @OnEvent('payment.ready')
  onPaymentReady(e: PaymentReadyEvent): void {
    this.logger.log(`payment.ready: document ${e.documentId} is ready to pay`);
  }

  @OnEvent('payment.settled')
  onPaymentSettled(e: PaymentSettledEvent): void {
    this.logger.log(`payment.settled: document ${e.documentId} FX ${e.fxKind} ${e.fxDelta}`);
  }
}
