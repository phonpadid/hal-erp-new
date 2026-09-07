import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PaymentService } from './payment.service';

interface PaymentReadyEvent {
  documentId: string;
}

interface PaymentSettledEvent {
  documentId: string;
  fxDelta: string;
  fxKind: string;
}

/**
 * Consumes payment events. A dispatch seam: an external accounting integration can hook in here
 * without touching the approval/payment flow. `payment.ready` fires when a CUT_BUDGET document
 * settles; `payment.settled` fires when an actual payment + FX is recorded.
 */
@Injectable()
export class PaymentHandoffListener {
  private readonly logger = new Logger(PaymentHandoffListener.name);

  constructor(private readonly payments: PaymentService) {}

  /**
   * Close the loop the transfer slip already opened.
   *
   * In this company the money leaves the bank BEFORE the document finishes its approvals: finance
   * pays, attaches the slip at the step that demands one, and states there which account it left
   * and at what rate. When the document then completes, the payment record is a transcription of
   * facts already stated — so it is written here rather than waiting for somebody to retype them
   * into a form days later.
   *
   * Post-commit and non-propagating, the contract every listener in this codebase keeps: the
   * approval is already granted and must not be disturbed by anything that happens afterwards. A
   * document whose slip stated too little, or whose recording failed, simply stays in the
   * ready-to-pay queue and is recorded by hand — the behaviour that shipped before this.
   */
  @OnEvent('payment.ready')
  async onPaymentReady(e: PaymentReadyEvent): Promise<void> {
    try {
      const recorded = await this.payments.recordFromSlip(e.documentId);
      if (recorded) {
        this.logger.log(
          `payment.ready: document ${e.documentId} recorded from its transfer slip ` +
            `(${recorded.transferFrom} @ ${recorded.actualRate}, FX ${recorded.fxKind} ${recorded.fxDelta})`,
        );
        return;
      }
      this.logger.log(
        `payment.ready: document ${e.documentId} is ready to pay — its slips state no account and ` +
          'rate, so it waits to be recorded by hand',
      );
    } catch (err) {
      // Loudly: the document is still payable and still in the queue, but somebody has to be told
      // that the automatic path did not take, or nobody will look at the queue.
      this.logger.error(
        `payment.ready: recording document ${e.documentId} from its slip failed, leaving it in the ` +
          `ready-to-pay queue: ${(err as Error).message}`,
      );
    }
  }

  @OnEvent('payment.settled')
  onPaymentSettled(e: PaymentSettledEvent): void {
    this.logger.log(`payment.settled: document ${e.documentId} FX ${e.fxKind} ${e.fxDelta}`);
  }
}
