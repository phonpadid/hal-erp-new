import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { NotificationService } from './notification.service';

const FILTER_OFF = { filters: { company: false } } as const;

interface StepAssignedEvent {
  documentId: string;
  stepNo: number;
  approverUserIds: string[];
}
interface OutcomeEvent {
  documentId: string;
  status: string;
  requesterId: string;
}
interface CancelledEvent {
  documentId: string;
  requesterId?: string;
  /** The step the document was withdrawn from; 0 when it had never routed. */
  stepNo: number;
}

/** Turns approval-workflow domain events into notifications. */
@Injectable()
export class NotificationEventsListener {
  private readonly logger = new Logger(NotificationEventsListener.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly em: EntityManager,
    private readonly resolver: ApproverResolverService,
    private readonly route: DocumentRouteService,
  ) {}

  @OnEvent('approval.step-assigned')
  async onStepAssigned(e: StepAssignedEvent): Promise<void> {
    await this.notifications.notifyApprovalPending(e.documentId, e.approverUserIds);
  }

  @OnEvent('approval.outcome')
  async onOutcome(e: OutcomeEvent): Promise<void> {
    await this.notifications.notifyOutcome(e.documentId, e.status);
  }

  /**
   * A withdrawal takes the item away from whoever was holding it.
   *
   * The eligible actors are resolved HERE rather than by the emitter: `DocumentSubmitService` lives
   * in the document module, which cannot reach `ApproverResolverService` without a cycle (the
   * approval module imports the submit service), while this module already depends on that resolver
   * for the SLA sweep. The emitter states what happened; this decides who cares.
   *
   * Runs after the withdrawal has committed, so a failure here costs a message, never the record.
   */
  @OnEvent('document.cancelled')
  async onCancelled(e: CancelledEvent): Promise<void> {
    // Step 0 means it never routed — a withdrawn draft interrupts nobody.
    if (!e.stepNo) return;
    try {
      const em = this.em.fork();
      const document = await em.findOne(Document, { id: e.documentId }, FILTER_OFF);
      if (!document) return;
      // The step as the document recorded it, not as the workflow stands now.
      const step = await this.route.routeStep(e.documentId, e.stepNo, em);
      if (!step) return;

      const actors = await this.resolver.eligible(step, document);
      const approverIds = [...new Set(actors.map((a) => a.userId))];
      const requester = e.requesterId
        ? await em.findOne(AppUser, { id: e.requesterId }, FILTER_OFF)
        : null;
      await this.notifications.notifyWithdrawn(e.documentId, approverIds, requester?.username);
    } catch (err) {
      this.logger.warn(`Could not notify the approvers of withdrawn ${e.documentId}: ${String(err)}`);
    }
  }
}
