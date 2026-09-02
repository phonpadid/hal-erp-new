import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalRoutingService } from './approval-routing.service';

/**
 * Auto-starts approval routing when a document is submitted (decoupled from document-engine
 * via the event, so the build-order dependency stays document → approval).
 *
 * Routing runs after the submit has committed, so a failure here cannot undo the submit. What
 * it can do is say so. Three very different things arrive at the same `catch`:
 *
 *   not SUBMITTED           a redelivery of the event, or the author withdrew the document in the
 *                           window between the submit committing and this listener running.
 *                           Nothing is wrong; the document is where somebody meant it to be.
 *   no applicable step      no step engages this document, so NOTHING will ever pick it up. It
 *                           stays SUBMITTED forever, holding the budget it reserved, and no
 *                           approver is ever notified.
 *   anything else           the route could not be written at all — same outcome as above, reached
 *                           by a different road. This is the branch that hid a defect: every
 *                           resubmission of a returned document violated
 *                           `document_approval_step_live_uniq`, and the exception left through
 *                           `logger.debug`, a level that is off by default and therefore not a log
 *                           at all. Thirty-seven documents were stranded before anyone looked.
 *
 * Only the first is quiet. The other two hold appropriations nobody can release — a reservation
 * comes back through a settlement or a rejection, and neither can happen to a document no one can
 * act on — so both name the document at error level.
 */
@Injectable()
export class ApprovalSubmittedListener {
  private readonly logger = new Logger(ApprovalSubmittedListener.name);

  constructor(private readonly routing: ApprovalRoutingService) {}

  @OnEvent('document.submitted')
  async onSubmitted(payload: { documentId: string }): Promise<void> {
    try {
      await this.routing.start(payload.documentId);
    } catch (err) {
      const message = (err as Error).message;
      // The document moved on without us. Not a fault: see the header.
      if (message.includes('not SUBMITTED') || message.includes('already')) {
        this.logger.debug(`No auto-start for ${payload.documentId}: ${message}`);
        return;
      }
      if (message.includes('no applicable steps')) {
        this.logger.error(
          `Document ${payload.documentId} is stranded: its workflow has no step that applies to ` +
            'this amount and this requester, so no approver will ever see it and the budget it ' +
            'reserved stays held. Check the workflow bands and step conditions against what this ' +
            'document is worth and who raised it.',
        );
        return;
      }
      // The route could not be written. The submit has committed and this listener cannot undo
      // it, so saying so — with the cause, and loudly enough to be read — is the only thing left
      // that helps. A document nobody can see is otherwise found by accident, months later.
      this.logger.error(
        `Document ${payload.documentId} was submitted but could not be routed, so it is stranded ` +
          `in SUBMITTED — in nobody's queue, still holding whatever its submit reserved. ` +
          `Resubmitting it starts a fresh route once the cause is fixed. Cause: ${message}`,
        (err as Error).stack,
      );
    }
  }
}
