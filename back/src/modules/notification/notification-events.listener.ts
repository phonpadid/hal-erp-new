import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from './notification.service';

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

/** Turns approval-workflow domain events into notifications. */
@Injectable()
export class NotificationEventsListener {
  constructor(private readonly notifications: NotificationService) {}

  @OnEvent('approval.step-assigned')
  async onStepAssigned(e: StepAssignedEvent): Promise<void> {
    await this.notifications.notifyApprovalPending(e.documentId, e.approverUserIds);
  }

  @OnEvent('approval.outcome')
  async onOutcome(e: OutcomeEvent): Promise<void> {
    await this.notifications.notifyOutcome(e.documentId, e.status);
  }
}
