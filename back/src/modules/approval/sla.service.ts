import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { ApproveAction, DocStatus } from '../../common/enums';
import { inTransaction } from '../../common/uow/unit-of-work';
import { WorkingTimeService } from '../multi-company/working-time.service';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { ApprovalLog, WorkflowStep } from './approval.entities';
import { ApproverResolverService } from './approver-resolver.service';
import { WorkflowStepResolver } from './workflow-step.resolver';

const FILTER_OFF = { filters: { company: false } } as const;

/** The outcome of an escalation: the step it moved from/to and who must now act. */
export interface EscalationResult {
  fromStepNo: number;
  toStepNo: number;
  newApproverIds: string[];
}

/**
 * Working-hour SLA. Due-time computation skips weekends + company holidays. The periodic
 * sweep (NotificationScheduler) calls escalateOverdue() for overdue items after notifying.
 */
@Injectable()
export class SlaService {
  constructor(
    private readonly em: EntityManager,
    private readonly workingTime: WorkingTimeService,
    private readonly resolver: ApproverResolverService,
    private readonly steps: WorkflowStepResolver,
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
    const step = await em.findOne(
      WorkflowStep,
      { workflow: document.workflow.id, stepNo: document.currentStepNo },
      FILTER_OFF,
    );
    if (!step?.slaHours) return { currentStepNo: document.currentStepNo, slaDueAt: null, overdue: false };
    const due = await this.stepDueAt(document.submittedAt, step.slaHours, document.company.id);
    return { currentStepNo: document.currentStepNo, slaDueAt: due, overdue: now > due };
  }

  /**
   * Escalate an overdue current step by forwarding to the next applicable step. Runs in one
   * transaction that locks the document row, appends an append-only ESCALATE log, and advances
   * current_step_no. Returns the reassignment, or null when nothing was escalated:
   *  - the document is no longer IN_APPROVAL / not overdue,
   *  - the overdue step has an active delegate (the delegate handles it),
   *  - the overdue step has no real principal to escalate from,
   *  - there is no further applicable step whose actor is not the document's creator.
   * (The schema has no superior relationship, so superior-based escalation is out of scope.)
   */
  async escalateOverdue(documentId: string, now: Date = new Date()): Promise<EscalationResult | null> {
    return inTransaction(this.em, async (tem) => {
      const document = await tem.findOne(Document, { id: documentId }, {
        ...FILTER_OFF,
        lockMode: LockMode.PESSIMISTIC_WRITE,
        populate: ['createdBy', 'company', 'workflow', 'documentType'],
      });
      if (!document || document.status !== DocStatus.IN_APPROVAL || !document.submittedAt) return null;

      const fromStepNo = document.currentStepNo;
      const current = await tem.findOne(
        WorkflowStep,
        { workflow: document.workflow.id, stepNo: fromStepNo },
        { ...FILTER_OFF, populate: ['approverUser', 'approverRole'] },
      );
      if (!current?.slaHours) return null;

      const due = await this.stepDueAt(document.submittedAt, current.slaHours, document.company.id);
      if (now <= due) return null;

      // An active delegate on the overdue step can still act — don't escalate past them.
      const currentActors = await this.resolver.eligible(current, document);
      if (currentActors.some((a) => a.delegatedFrom)) return null;

      // Must have a real principal to record the escalation "from".
      const fromPrincipals = await this.resolver.principals(current, document.company.id);
      if (fromPrincipals.length === 0) return null;

      // Forward to the next applicable step whose eligible actor is not solely the creator.
      const creatorId = document.createdBy.id;
      const steps = await this.steps.applicableSteps(document, tem);
      const idx = steps.findIndex((s) => s.stepNo === fromStepNo);
      let target: WorkflowStep | undefined;
      let targetApproverIds: string[] = [];
      for (let i = idx + 1; i < steps.length; i++) {
        const actors = await this.resolver.eligible(steps[i], document);
        const ids = [...new Set(actors.map((a) => a.userId))].filter((id) => id !== creatorId);
        if (ids.length > 0) {
          target = steps[i];
          targetApproverIds = ids;
          break;
        }
      }
      if (!target) return null;

      // Append-only ESCALATE audit row; approver = the overdue principal (SLA subject).
      tem.persist(
        tem.create(ApprovalLog, {
          document: tem.getReference(Document, documentId),
          stepNo: fromStepNo,
          approver: tem.getReference(AppUser, fromPrincipals[0]),
          action: ApproveAction.ESCALATE,
          remark: `SLA breach: escalated from step ${fromStepNo} to step ${target.stepNo}`,
          actedAt: now,
        }),
      );
      document.currentStepNo = target.stepNo;
      await tem.flush();

      return { fromStepNo, toStepNo: target.stepNo, newApproverIds: targetApproverIds };
    });
  }
}
