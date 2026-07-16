import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApproveAction, DocStatus } from '../../common/enums';
import { inTransaction } from '../../common/uow/unit-of-work';
import { RequestContext } from '../../common/context/request-context';
import { DocumentSubmitService } from '../document/document-submit.service';
import { Document } from '../document/document.entities';
import { AppUser, UserSignature } from '../rbac/rbac.entities';
import { ApprovalLog, WorkflowStep } from './approval.entities';
import { ApproverResolverService } from './approver-resolver.service';
import { PostActionService } from './post-action.service';
import { WorkflowStepResolver } from './workflow-step.resolver';
import type { ActDto } from './dto/workflow.dto';

const FILTER_OFF = { filters: { company: false } } as const;

/** One approver the document is waiting on; delegatedFrom names the principal for a delegate. */
export interface PendingApprover {
  userId: string;
  name: string;
  delegatedFrom?: string;
}

/** The current step the document is waiting on, with its eligible approvers. */
export interface PendingStep {
  stepNo: number;
  stepName?: string;
  approveMode: string;
  roleName?: string;
  approvers: PendingApprover[];
}

export interface PendingApproversResult {
  pending: PendingStep | null;
}

/** Drives a submitted document through its workflow steps to a terminal state. */
@Injectable()
export class ApprovalRoutingService {
  constructor(
    private readonly em: EntityManager,
    private readonly resolver: ApproverResolverService,
    private readonly postAction: PostActionService,
    private readonly documentSubmit: DocumentSubmitService,
    private readonly steps: WorkflowStepResolver,
    // Optional: present in the running app (EventEmitterModule), absent in unit tests.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  private emit(event: string, payload: Record<string, unknown>): void {
    this.events?.emit(event, payload);
  }

  /** Eligible approver user ids for a step (deduped). */
  private async approverIds(step: WorkflowStep, document: Document): Promise<string[]> {
    const actors = await this.resolver.eligible(step, document);
    return [...new Set(actors.map((a) => a.userId))];
  }

  /** Steps of the bound workflow that apply (amount band + requester position level). */
  private applicableSteps(document: Document, em: EntityManager): Promise<WorkflowStep[]> {
    return this.steps.applicableSteps(document, em);
  }

  /** Begin routing: SUBMITTED → IN_APPROVAL at the first applicable step. */
  async start(documentId: string): Promise<void> {
    const em = this.em.fork();
    const document = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    if (document.status !== DocStatus.SUBMITTED) {
      throw new BadRequestException(`Document ${documentId} is not SUBMITTED`);
    }
    const steps = await this.applicableSteps(document, em);
    if (steps.length === 0) throw new BadRequestException('Workflow has no applicable steps');
    document.currentStepNo = steps[0].stepNo;
    document.status = DocStatus.IN_APPROVAL;
    await em.flush();
    this.emit('approval.step-assigned', {
      documentId,
      stepNo: steps[0].stepNo,
      approverUserIds: await this.approverIds(steps[0], document),
    });
  }

  private async stepComplete(document: Document, step: WorkflowStep, em: EntityManager): Promise<boolean> {
    const approvals = await em.find(
      ApprovalLog,
      { document: document.id, stepNo: step.stepNo, action: ApproveAction.APPROVE },
      { ...FILTER_OFF, populate: ['approver', 'delegatedFrom'] },
    );
    if (step.approveMode === 'PARALLEL_ALL') {
      const approvedPrincipals = new Set(approvals.map((a) => a.delegatedFrom?.id ?? a.approver.id));
      const principals = await this.resolver.principals(step, document.company.id);
      return principals.length > 0 && principals.every((p) => approvedPrincipals.has(p));
    }
    // SEQUENTIAL / PARALLEL_ANY
    return approvals.length >= 1;
  }

  /**
   * UX gate: whether the active user may act on the document's current step right now —
   * it must be IN_APPROVAL, the user must be an eligible principal/delegate for the current
   * step, and not the creator (invariant 8). Lets the client hide the action buttons; act()
   * remains the authoritative enforcement.
   */
  async canAct(documentId: string): Promise<boolean> {
    const userId = RequestContext.userId();
    if (!userId) return false;
    const em = this.em.fork();
    const document = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    if (!document || document.status !== DocStatus.IN_APPROVAL) return false;
    if (document.createdBy.id === userId) return false;
    const step = await em.findOne(
      WorkflowStep,
      { workflow: document.workflow.id, stepNo: document.currentStepNo },
      { ...FILTER_OFF, populate: ['approverUser', 'approverRole'] },
    );
    if (!step) return false;
    const actors = await this.resolver.eligible(step, document);
    return actors.some((a) => a.userId === userId);
  }

  /**
   * Read-only: the approvers the document is waiting on right now. Returns {pending: null} when
   * the document is not IN_APPROVAL (nothing to wait on). Visible only to participants — the
   * creator or an eligible approver of any applicable step — so approver identities are not
   * exposed to unrelated DOC_VIEW users; a non-participant gets NotFound. Reuses the same
   * resolver and step-engagement rules as routing, so the shown set matches who can act now.
   * Delegation is reflected one hop only (invariant 8). This never changes who may act.
   */
  async pendingApprovers(documentId: string): Promise<PendingApproversResult> {
    const userId = RequestContext.userId();
    const em = this.em.fork();
    const document = await em.findOne(Document, { id: documentId }, FILTER_OFF);
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    if (document.status !== DocStatus.IN_APPROVAL) return { pending: null };

    const steps = await this.applicableSteps(document, em);
    const step = steps.find((s) => s.stepNo === document.currentStepNo);
    if (!step) return { pending: null };

    // Participant visibility: the creator, or an eligible actor (principal or delegate) of any
    // applicable step. Resolve per step and stop as soon as the caller is found.
    let isParticipant = !!userId && document.createdBy.id === userId;
    const stepActors = new Map<number, Awaited<ReturnType<ApproverResolverService['eligible']>>>();
    for (const s of steps) {
      const actors = await this.resolver.eligible(s, document);
      stepActors.set(s.stepNo, actors);
      if (userId && actors.some((a) => a.userId === userId)) isParticipant = true;
    }
    if (!isParticipant) throw new NotFoundException(`Document ${documentId} not found`);

    // Resolve display names for the current step's actors and their principals in one query.
    const actors = stepActors.get(step.stepNo)!;
    const ids = new Set<string>();
    for (const a of actors) {
      ids.add(a.userId);
      if (a.delegatedFrom) ids.add(a.delegatedFrom);
    }
    const users = ids.size
      ? await em.find(AppUser, { id: { $in: [...ids] } }, FILTER_OFF)
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.username]));

    return {
      pending: {
        stepNo: step.stepNo,
        stepName: step.stepName,
        approveMode: step.approveMode,
        roleName: step.approverRole?.name,
        approvers: actors.map((a) => ({
          userId: a.userId,
          name: nameOf.get(a.userId) ?? a.userId,
          delegatedFrom: a.delegatedFrom ? (nameOf.get(a.delegatedFrom) ?? a.delegatedFrom) : undefined,
        })),
      },
    };
  }

  /** Approve / reject / return / delegate on the current step. */
  async act(documentId: string, dto: ActDto): Promise<void> {
    const actingUserId = RequestContext.userId()!;
    let releaseAfter = false;
    let completedAfter = false;
    const emitAfter: Array<{ event: string; payload: Record<string, unknown> }> = [];

    await inTransaction(this.em, async (tem) => {
      // Lock the document row so a concurrent escalation sweep can't advance the same
      // step underneath us (and vice-versa) — they serialize on this row.
      const document = await tem.findOne(Document, { id: documentId }, {
        ...FILTER_OFF,
        lockMode: LockMode.PESSIMISTIC_WRITE,
      });
      if (!document) throw new NotFoundException(`Document ${documentId} not found`);
      if (document.status !== DocStatus.IN_APPROVAL) {
        throw new BadRequestException(`Document ${documentId} is not in approval`);
      }
      const step = await tem.findOne(
        WorkflowStep,
        { workflow: document.workflow.id, stepNo: document.currentStepNo },
        { ...FILTER_OFF, populate: ['approverUser', 'approverRole'] },
      );
      if (!step) throw new BadRequestException('No current workflow step');

      // Eligibility (principal or active delegate).
      const actors = await this.resolver.eligible(step, document);
      const entry = actors.find((a) => a.userId === actingUserId);
      if (!entry) throw new ForbiddenException('Not an eligible approver for this step');

      // Self-approval block (invariant 8): acting user or the delegator is the creator.
      const creatorId = document.createdBy.id;
      if (actingUserId === creatorId || entry.delegatedFrom === creatorId) {
        throw new ForbiddenException('A document cannot be approved by its creator');
      }

      // On APPROVE, snapshot the approver's current signature onto the log — locked at
      // approval time (like the stamped FX rate), so a later signature change never rewrites
      // this record. Reject/return/delegate carry no signature; a missing signature is fine
      // (null) and never blocks approval. Set only at insert — the row stays append-only.
      let signatureId: string | undefined;
      if (dto.action === ApproveAction.APPROVE) {
        const actingUser = await tem.findOne(AppUser, { id: actingUserId });
        signatureId = actingUser?.currentSignatureId ?? undefined;
      }

      // Append-only audit row.
      tem.persist(
        tem.create(ApprovalLog, {
          document: tem.getReference(Document, documentId),
          stepNo: document.currentStepNo,
          approver: tem.getReference(AppUser, actingUserId),
          delegatedFrom: entry.delegatedFrom ? tem.getReference(AppUser, entry.delegatedFrom) : undefined,
          action: dto.action,
          signature: signatureId ? tem.getReference(UserSignature, signatureId) : undefined,
          remark: dto.remark,
          actedAt: new Date(),
        }),
      );
      await tem.flush(); // make the log visible to completion checks

      const requesterId = document.createdBy.id;
      switch (dto.action) {
        case ApproveAction.REJECT:
          document.status = DocStatus.REJECTED;
          releaseAfter = true;
          emitAfter.push({ event: 'approval.outcome', payload: { documentId, status: 'REJECTED', requesterId } });
          break;
        case ApproveAction.RETURN:
          document.status = DocStatus.DRAFT;
          releaseAfter = true;
          emitAfter.push({ event: 'approval.outcome', payload: { documentId, status: 'RETURNED', requesterId } });
          break;
        case ApproveAction.DELEGATE:
          break; // recorded; reassignment is handled by resolution
        case ApproveAction.APPROVE:
          if (await this.stepComplete(document, step, tem)) {
            const steps = await this.applicableSteps(document, tem);
            const idx = steps.findIndex((s) => s.stepNo === document.currentStepNo);
            const next = steps[idx + 1];
            if (next) {
              document.currentStepNo = next.stepNo;
              emitAfter.push({
                event: 'approval.step-assigned',
                payload: { documentId, stepNo: next.stepNo, approverUserIds: await this.approverIds(next, document) },
              });
            } else {
              document.status = DocStatus.APPROVED;
              document.approvedAt = new Date();
              const pa = await this.postAction.run(document, tem); // atomic with the transition
              document.status = DocStatus.COMPLETED;
              completedAfter = true;
              emitAfter.push({ event: 'approval.outcome', payload: { documentId, status: 'COMPLETED', requesterId } });
              if (pa.paymentReady) emitAfter.push({ event: 'payment.ready', payload: { documentId } });
            }
          }
          break;
      }
      await tem.flush();
    });

    if (releaseAfter) await this.documentSubmit.releaseDocumentHolds(documentId);
    // Post-commit: auto-create the auto_create successors when the completed type is CREATE_SUCCESSOR.
    if (completedAfter) await this.postAction.createSuccessorIfConfigured(documentId);
    for (const e of emitAfter) this.emit(e.event, e.payload);
  }
}
