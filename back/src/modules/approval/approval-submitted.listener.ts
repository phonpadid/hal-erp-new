import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalRoutingService } from './approval-routing.service';

/**
 * Auto-starts approval routing when a document is submitted (decoupled from document-engine
 * via the event, so the build-order dependency stays document → approval).
 *
 * Routing runs after the submit has committed, so a failure here cannot undo the submit. What
 * it can do is say so. Two very different things used to arrive at the same `catch` and leave
 * by the same silent door:
 *
 *   already routed          a race or a redelivery. Nothing is wrong; the document is moving.
 *   no applicable step      the workflow's lowest band starts above this document's amount, so
 *                           NOTHING will ever pick it up. It stays SUBMITTED forever, holding
 *                           the budget it reserved, and no approver is ever notified.
 *
 * The second is a configuration defect that strands money, and it was being logged at `debug`
 * — a level that is off by default, which is to say it was not being logged at all. It is now
 * an error naming the document, because someone has to go and fix the workflow.
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
      if (message.includes('no applicable steps')) {
        this.logger.error(
          `Document ${payload.documentId} is stranded: its workflow has no step that applies to ` +
            'this amount, so no approver will ever see it and the budget it reserved stays held. ' +
            'Fix the workflow bands — the lowest band must start at zero.',
        );
        return;
      }
      this.logger.debug(`No auto-start for ${payload.documentId}: ${message}`);
    }
  }
}
