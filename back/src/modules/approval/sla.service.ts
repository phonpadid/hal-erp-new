import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { ApproveAction, DocStatus } from '../../common/enums';
import { inTransaction } from '../../common/uow/unit-of-work';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ApprovalLog, DocumentApprovalStep } from './approval.entities';
import { ApproverResolverService } from './approver-resolver.service';
import { DocumentRouteService } from './document-route.service';

const FILTER_OFF = { filters: { company: false } } as const;

/** The outcome of an escalation: the step that gained an actor, and who that is. */
export interface EscalationResult {
  /** The step the document is STILL on — escalation adds an actor, it does not advance. */
  stepNo: number;
  escalatedTo: string;
  newApproverIds: string[];
}

/**
 * Working-hour SLA. Due-time computation skips weekends + company holidays. The periodic
 * sweep (NotificationScheduler) calls escalateOverdue() for overdue items after notifying.
 *
 * Every clock here starts at the step's own `started_at`. It used to start at
 * `document.submitted_at` for every step, because that was the only start time in existence — so a
 * step inherited whatever the steps before it had spent, and on a route whose first approver
 * overran, every later step was overdue the moment it opened and the sweep escalated past its
 * approver before they had seen it.
 */
@Injectable()
export class SlaService {
  constructor(
    private readonly em: EntityManager,
    private readonly workingTime: WorkingTimeService,
    private readonly resolver: ApproverResolverService,
    private readonly route: DocumentRouteService,
  ) {}

  /** When a step becomes overdue, in working hours from its start. */
  stepDueAt(stepStart: Date, slaHours: number, companyId?: string): Promise<Date> {
    return this.workingTime.addWorkingHours(stepStart, slaHours, companyId);
  }

  /** Current-step SLA status for a document detail view (null when not in approval). */
  async currentStepSla(
    documentId: string,
    now: Date = new Date(),
  ): Promise<{ currentStepNo: number; slaDueAt: Date | null; overdue: boolean } | null> {
    const em = this.em.fork();
    const document = await em.findOne(Document, { id: documentId }, { ...FILTER_OFF, populate: ['company', 'workflow'] });
    if (!document || document.status !== DocStatus.IN_APPROVAL || !document.submittedAt) return null;
    const step = await this.route.routeStep(documentId, document.currentStepNo, em);
    if (!step?.slaHours) return { currentStepNo: document.currentStepNo, slaDueAt: null, overdue: false };
    const due = await this.stepDueAt(step.startedAt ?? document.submittedAt, step.slaHours, document.company.id);
    return { currentStepNo: document.currentStepNo, slaDueAt: due, overdue: now > due };
  }

  /**
   * Escalate an overdue step by giving it ANOTHER ACTOR — never by moving past it.
   *
   * This used to advance `current_step_no`, which meant the approval the amount band and the
   * job-level condition said the document required was performed by nobody: not rejected, not
   * approved, not reassigned. A requester who would rather avoid a given approver could remove them
   * by waiting out `sla_hours`. No standard system does that: a timeout is a question of WHO, never
   * of WHETHER.
   *
   * Returns who was added, or null when nothing was escalated:
   *  - the document is no longer IN_APPROVAL / the step is not overdue,
   *  - the step has an active delegate (the delegate can still act),
   *  - the step has no real principal to escalate FROM,
   *  - the step names no escalation target — it is chased instead (see the sweep),
   *  - the step is PARALLEL_ALL, which one actor cannot stand in for,
   *  - the target resolves to nobody, or only to the document's creator,
   *  - the step was already escalated.
   */
  async escalateOverdue(documentId: string, now: Date = new Date()): Promise<EscalationResult | null> {
    return inTransaction(this.em, async (tem) => {
      const document = await tem.findOne(Document, { id: documentId }, {
        ...FILTER_OFF,
        lockMode: LockMode.PESSIMISTIC_WRITE,
        populate: ['createdBy', 'company', 'workflow', 'documentType'],
      });
      if (!document || document.status !== DocStatus.IN_APPROVAL || !document.submittedAt) return null;

      const stepNo = document.currentStepNo;
      const current = await tem.findOne(
        DocumentApprovalStep,
        { document: documentId, stepNo, supersededAt: null },
        { ...FILTER_OFF, populate: ['approverUser', 'approverRole', 'escalateToUser', 'escalateToRole', 'escalatedToUser'] },
      );
      if (!current?.slaHours) return null;

      // From when THIS step opened, not from when the document was submitted.
      const due = await this.stepDueAt(current.startedAt ?? document.submittedAt, current.slaHours, document.company.id);
      if (now <= due) return null;

      // Already escalated: the sweep keeps chasing, but the trail gets one row per escalation, not
      // one per sweep.
      if (current.escalatedAt) return null;

      // An active delegate on the overdue step can still act — nothing to escalate.
      const currentActors = await this.resolver.eligible(current, document);
      if (currentActors.some((a) => a.delegatedFrom)) return null;

      // A PARALLEL_ALL step exists because N named people must each sign off. One escalation target
      // cannot stand in for a committee, and no rule says which of the recorded actors their
      // approval would discharge — so it is chased, never reassigned.
      if (current.approveMode === 'PARALLEL_ALL') return null;

      // Must have a real principal to record the escalation FROM.
      const fromPrincipals = await this.resolver.principals(current, document.company.id);
      if (fromPrincipals.length === 0) return null;

      // Who the step names. Resolved now, not at submit: the role's holders may have changed, and
      // only WHICH role was frozen with the route.
      const targetIds = (
        await this.resolver.principals(
          { approverUser: current.escalateToUser, approverRole: current.escalateToRole },
          document.company.id,
        )
      ).filter((id) => id !== document.createdBy.id && !fromPrincipals.includes(id));
      if (targetIds.length === 0) return null;

      const escalatedTo = targetIds[0];
      current.escalatedToUser = tem.getReference(AppUser, escalatedTo);
      current.escalatedAt = now;

      // Append-only ESCALATE row. `approver` stays the overdue principal — the SLA's subject — and
      // the target is named in the remark, because that column means "who acted" and the target has
      // not acted yet.
      tem.persist(
        tem.create(ApprovalLog, {
          document: tem.getReference(Document, documentId),
          stepNo,
          approver: tem.getReference(AppUser, fromPrincipals[0]),
          action: ApproveAction.ESCALATE,
          remark: `SLA breach on step ${stepNo}: escalated from ${fromPrincipals[0]} to ${escalatedTo}`,
          actedAt: now,
        }),
      );
      await tem.flush();

      return { stepNo, escalatedTo, newApproverIds: [escalatedTo] };
    });
  }
}
