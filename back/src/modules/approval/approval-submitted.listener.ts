import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalRoutingService } from './approval-routing.service';

/**
 * Auto-starts approval routing when a document is submitted (decoupled from document-engine
 * via the event, so the build-order dependency stays document → approval). A document whose
 * workflow has no applicable step simply stays SUBMITTED.
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
      // No applicable step (or already routed): leave it SUBMITTED, recoverable.
      this.logger.debug(`No auto-start for ${payload.documentId}: ${(err as Error).message}`);
    }
  }
}
