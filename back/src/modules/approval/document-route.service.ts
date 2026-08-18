import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import {
  DocumentApprovalStep,
  DocumentApprovalStepActor,
  ROUTE_STEP_STATUS,
} from './approval.entities';
import { ApproverResolverService } from './approver-resolver.service';
import { WorkflowStepResolver } from './workflow-step.resolver';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * The route a document runs: written once at submit, read by everything afterwards.
 *
 * Every reader used to ask `WorkflowStep {workflow, stepNo}` and get an answer that could have
 * changed since the document was submitted. They now ask this service, which answers from rows the
 * document owns. The `supersededAt: null` clause lives here and nowhere else, so no caller can
 * forget it and quietly read a superseded attempt's route.
 */
@Injectable()
export class DocumentRouteService {
  constructor(
    private readonly em: EntityManager,
    private readonly steps: WorkflowStepResolver,
    private readonly resolver: ApproverResolverService,
  ) {}

  /**
   * Resolve the applicable configured steps ONCE and record them.
   *
   * Called inside submit's own transaction, so a document either gets its holds and its route or
   * gets neither. A resubmission supersedes the previous attempt's rows rather than deleting them:
   * each attempt keeps the record of the chain it actually ran.
   *
   * Returns the recorded steps in `step_no` order (empty when the workflow engages none, which the
   * caller refuses loudly rather than leaving a document that can never move).
   */
  async materialise(document: Document, em: EntityManager): Promise<DocumentApprovalStep[]> {
    const now = new Date();
    const previous = await em.find(
      DocumentApprovalStep,
      { document: document.id, supersededAt: null },
      FILTER_OFF,
    );
    for (const row of previous) row.supersededAt = now;

    const configured = await this.steps.applicableSteps(document, em);
    const rows = configured.map((s) =>
      em.create(DocumentApprovalStep, {
        document: em.getReference(Document, document.id),
        stepNo: s.stepNo,
        stepName: s.stepName,
        approverRole: s.approverRole,
        approverUser: s.approverUser,
        approveMode: s.approveMode,
        slaHours: s.slaHours,
        escalateToRole: s.escalateToRole,
        escalateToUser: s.escalateToUser,
        showSignatureOnPdf: s.showSignatureOnPdf,
        status: ROUTE_STEP_STATUS.PENDING,
        sourceWorkflowStep: s,
        createdAt: now,
      }),
    );
    for (const row of rows) em.persist(row);
    await em.flush();
    return rows;
  }

  /** The document's live route, in step order. */
  routeSteps(documentId: string, em: EntityManager = this.em): Promise<DocumentApprovalStep[]> {
    return em.find(
      DocumentApprovalStep,
      { document: documentId, supersededAt: null },
      {
        ...FILTER_OFF,
        orderBy: { stepNo: 'ASC' },
        populate: ['approverUser', 'approverRole', 'escalateToUser', 'escalateToRole', 'escalatedToUser'],
      },
    );
  }

  /** The one live route step a document waits on, or null. */
  routeStep(
    documentId: string,
    stepNo: number,
    em: EntityManager = this.em,
  ): Promise<DocumentApprovalStep | null> {
    return em.findOne(
      DocumentApprovalStep,
      { document: documentId, stepNo, supersededAt: null },
      {
        ...FILTER_OFF,
        populate: ['approverUser', 'approverRole', 'escalateToUser', 'escalateToRole', 'escalatedToUser'],
      },
    );
  }

  /**
   * Open a step: stamp when its clock starts, and record the principals it waits for.
   *
   * The actors are recorded HERE rather than at submit because a role change between a document
   * being submitted and this step opening should reach it. What must not move is the set while the
   * step is being approved — `stepComplete` used to resolve holders live, so a PARALLEL_ALL step
   * gained a required approval whenever somebody was granted the role.
   */
  async openStep(step: DocumentApprovalStep, document: Document, em: EntityManager, at = new Date()): Promise<void> {
    step.startedAt = at;
    step.status = ROUTE_STEP_STATUS.PENDING;
    const existing = await em.count(DocumentApprovalStepActor, { step: step.id }, FILTER_OFF);
    if (existing === 0) {
      const principals = await this.resolver.principals(step, document.company.id);
      for (const userId of principals) {
        em.persist(
          em.create(DocumentApprovalStepActor, {
            step: em.getReference(DocumentApprovalStep, step.id),
            user: em.getReference(AppUser, userId),
          }),
        );
      }
    }
    await em.flush();
  }

  /** Close a step as done. */
  async closeStep(step: DocumentApprovalStep, em: EntityManager, at = new Date()): Promise<void> {
    step.completedAt = at;
    step.status = ROUTE_STEP_STATUS.DONE;
    await em.flush();
  }

  /** The principals recorded when this step opened (empty before it opens). */
  async recordedActors(stepId: string, em: EntityManager = this.em): Promise<string[]> {
    const rows = await em.find(DocumentApprovalStepActor, { step: stepId }, { ...FILTER_OFF, populate: ['user'] });
    return [...new Set(rows.map((r) => r.user.id))];
  }
}
