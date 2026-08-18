import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DocStatus } from '../../common/enums';
import { Document } from '../document/document.entities';
import { ApproverResolverService } from '../approval/approver-resolver.service';
import { DocumentRouteService } from '../approval/document-route.service';
import { SlaService } from '../approval/sla.service';
import { NotificationService } from './notification.service';

const FILTER_OFF = { filters: { company: false } } as const;

/** Scans IN_APPROVAL documents past their step SLA and notifies the approvers. */
@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);

  constructor(
    private readonly em: EntityManager,
    private readonly sla: SlaService,
    private readonly resolver: ApproverResolverService,
    private readonly notifications: NotificationService,
    private readonly route: DocumentRouteService,
  ) {}

  /** Hourly SLA sweep. The scan logic is in scanOverdue() (unit-tested). */
  @Interval(60 * 60 * 1000)
  async sweep(): Promise<void> {
    const n = await this.scanOverdue();
    if (n > 0) this.logger.log(`SLA sweep notified ${n} overdue document(s)`);
  }

  /** Notify approvers of every IN_APPROVAL document whose current step is overdue. */
  async scanOverdue(now: Date = new Date()): Promise<number> {
    const docs = await this.em.fork().find(Document, { status: DocStatus.IN_APPROVAL }, FILTER_OFF);
    let notified = 0;
    for (const doc of docs) {
      if (!doc.submittedAt) continue;
      const step = await this.route.routeStep(doc.id, doc.currentStepNo);
      if (!step?.slaHours) continue;
      // From when the step opened. Measuring from submit made every step after a slow one overdue
      // on arrival, and the sweep below escalated past its approver before they had seen it.
      const due = await this.sla.stepDueAt(step.startedAt ?? doc.submittedAt, step.slaHours, doc.company.id);
      if (now <= due) continue;

      const actors = await this.resolver.eligible(step, doc);
      const approverIds = [...new Set(actors.map((a) => a.userId))];
      if (approverIds.length > 0) {
        await this.notifications.notifyApprovalPending(doc.id, approverIds, { overdue: true });
        notified += 1;
      }

      // Escalation gives the overdue step ANOTHER actor; it never moves the document past it. A
      // step that names no target (or a PARALLEL_ALL step, which one person cannot stand in for)
      // escalates nothing — the notification above is the chase, and it repeats every sweep.
      const escalation = await this.sla.escalateOverdue(doc.id, now);
      if (escalation && escalation.newApproverIds.length > 0) {
        await this.notifications.notifyApprovalPending(doc.id, escalation.newApproverIds, { overdue: true });
        this.logger.log(`Step ${escalation.stepNo} of ${doc.id} escalated to ${escalation.escalatedTo}`);
      }
    }
    return notified;
  }
}
