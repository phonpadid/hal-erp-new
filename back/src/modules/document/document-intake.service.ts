import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { HttpStatus, Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { explained } from '../../common/errors/error-code';
import { CompanyScopeService } from '../../common/scope/company-scope.service';
import { ApproveAction, IntakeAction } from '../../common/enums';
import { ApprovalLog, DocumentApprovalStepActor } from '../approval/approval.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Document, DocumentIntakeLog } from './document.entities';
import { intakeStateFor, latestOf, type IntakeState } from './intake-read';

const FILTER_OFF = { filters: { company: false } } as const;

/** Why one document in a batch was not received. */
export const INTAKE_REFUSAL = {
  /** Its latest intake row is already a RECEIVE. */
  ALREADY_RECEIVED: 'ALREADY_RECEIVED',
  /** The route has never opened a step naming this user. */
  NOT_REACHED: 'NOT_REACHED',
  /** No such document in the active company. */
  NOT_FOUND: 'NOT_FOUND',
} as const;

export type IntakeRefusal = (typeof INTAKE_REFUSAL)[keyof typeof INTAKE_REFUSAL];

/** One document's outcome in a batch. `refusal` is null exactly when it was received. */
export interface IntakeOutcome {
  documentId: string;
  received: boolean;
  refusal: IntakeRefusal | null;
}

/**
 * Finance's intake book: registering that a document reached their desk.
 *
 * The rule for "reached my desk" is a ROUTING fact and nothing else.
 * `document_approval_step_actor` rows are written by `DocumentRouteService.openStep` when a step
 * OPENS and never before ("The principals recorded when this step opened (empty before it opens)"),
 * so a row naming a user on a live step IS the route's own record that the document arrived there.
 *
 * Three things it deliberately does NOT consult:
 *
 * - `role.code` / `department.dept_code`. Every workflow in the live data routes to a role named
 *   FINANCE, and naming it here would authorize on a role name (invariant 5) and hardcode one
 *   company's routing (invariant 7). A role-targeted step records every holder of the role as a
 *   principal when it opens, so "any finance officer may receive what reached finance" falls out
 *   of the route with no role name written down.
 * - `document.status`. Documents reach finance while still in approval, and those are exactly the
 *   ones to register. A DRAFT is excluded anyway: it has no route, so it has no opened step.
 * - `document.current_step_no`. It is not a how-far-did-it-get marker on this data — 357 COMPLETED
 *   documents sit at step 1 — and the actor rows already state the fact it would approximate.
 *
 * Receiving never advances, blocks or otherwise touches the approval route, and confers no
 * approval authority.
 */
@Injectable()
export class DocumentIntakeService {
  constructor(
    private readonly em: EntityManager,
    private readonly scope: CompanyScopeService,
  ) {}

  /**
   * Has this document been at this user's desk?
   *
   * Two sources, either of which is enough. Both are records the system already keeps; neither
   * is a status, a role name or a step number.
   *
   * 1. A LIVE route step naming them as a principal. `DocumentRouteService.openStep` writes those
   *    rows when a step OPENS and never before, so one existing IS the route's own record that
   *    the document arrived. Closing the step leaves it alone — an officer who signed on Monday
   *    and noticed on Friday that they never registered the paper can still register it.
   *
   * 2. An `approval_log` row naming them as the actor, other than a CANCEL. That ledger is
   *    append-only (invariant 2)
   *    and outlives any re-routing, which is exactly what source 1 cannot survive: a return and
   *    resubmit calls `materialise`, which supersedes EVERY live step row, actors and all. Without
   *    this clause an officer who signed the first attempt silently lost the ability to register
   *    paper sitting on their desk right now. `document.service` reads the same ledger for the
   *    same reason, and says so: "Acted on it. Append-only, so this never expires."
   *
   *    CANCEL is excluded because it is the REQUESTER withdrawing their own document, not a
   *    reviewer the route delivered it to. Every other action — approve, reject, return, an SLA
   *    escalation, a rate restatement, an account recode — is something done by a party the route
   *    brought the document to, which is precisely the fact being read.
   *
   * What it deliberately does NOT read:
   *
   * - `role.code` / `department.dept_code`. Every workflow in the live data routes to a role named
   *   FINANCE, and naming it here would authorize on a role name (invariant 5) and hardcode one
   *   company's routing (invariant 7). A role-targeted step records every holder of the role as a
   *   principal when it opens, so "any finance officer may receive what reached finance" falls out
   *   of the route with no role name written down.
   * - `document.status`. Documents reach finance while still in approval, and finish long before
   *   anyone notices the paper was never registered. A DRAFT is excluded anyway: it has no route,
   *   so it has no opened step and no recorded action.
   * - `document.current_step_no`. It is not a how-far-did-it-get marker on this data — 357
   *   COMPLETED documents sit at step 1 — and the two sources above already state the fact.
   *
   * Receiving never advances, blocks or otherwise touches the approval route, and confers no
   * approval authority.
   */
  async hasReached(documentId: string, userId: string, em: EntityManager = this.em): Promise<boolean> {
    const named = await em.count(
      DocumentApprovalStepActor,
      { user: userId, step: { document: documentId, supersededAt: null } },
      FILTER_OFF,
    );
    if (named > 0) return true;
    const acted = await em.count(
      ApprovalLog,
      { document: documentId, approver: userId, action: { $ne: ApproveAction.CANCEL } },
      FILTER_OFF,
    );
    return acted > 0;
  }

  /**
   * Register receipt of a batch.
   *
   * Each document is settled in its OWN transaction, so one refusal cannot roll back a sibling's
   * row: ticking twenty rows where a colleague already took one must register the other nineteen
   * and say which one it skipped. A whole-batch rollback would make the screen unusable exactly
   * when two people share the week's intake.
   */
  async receive(documentIds: string[]): Promise<IntakeOutcome[]> {
    const userId = RequestContext.userId()!;
    const companyId = RequestContext.companyId()!;

    // Company scope is applied to the id list BEFORE anything is written: an id from another
    // company is NOT_FOUND, never a receipt (invariant 1).
    const scoped = this.scope.forActiveCompany();
    const visible = await scoped.find(Document, { id: { $in: documentIds } }, { fields: ['id'] });
    const visibleIds = new Set(visible.map((d) => d.id));

    const out: IntakeOutcome[] = [];
    for (const documentId of documentIds) {
      if (!visibleIds.has(documentId)) {
        out.push({ documentId, received: false, refusal: INTAKE_REFUSAL.NOT_FOUND });
        continue;
      }
      out.push(await this.receiveOne(documentId, userId, companyId));
    }
    return out;
  }

  /**
   * One document, under its own row lock.
   *
   * The `document` row is taken PESSIMISTIC_WRITE before the latest intake row is read, so the
   * read-then-decide pair serialises: two officers pressing receive at the same moment produce one
   * RECEIVE row and one ALREADY_RECEIVED. A unique index cannot express this — the log is
   * append-only and legitimately holds RECEIVE, REVERSE, RECEIVE for one document, so uniqueness
   * on `document_id` is simply false.
   */
  private async receiveOne(documentId: string, userId: string, companyId: string): Promise<IntakeOutcome> {
    return this.em.transactional(async (tem) => {
      await tem.findOne(Document, { id: documentId }, { lockMode: LockMode.PESSIMISTIC_WRITE, ...FILTER_OFF });

      if (!(await this.hasReached(documentId, userId, tem))) {
        return { documentId, received: false, refusal: INTAKE_REFUSAL.NOT_REACHED };
      }
      if (await this.isReceived(documentId, tem)) {
        return { documentId, received: false, refusal: INTAKE_REFUSAL.ALREADY_RECEIVED };
      }

      tem.persist(
        tem.create(DocumentIntakeLog, {
          company: tem.getReference(Company, companyId),
          document: tem.getReference(Document, documentId),
          action: IntakeAction.RECEIVE,
          actor: tem.getReference(AppUser, userId),
          actedAt: new Date(),
        }),
      );
      return { documentId, received: true, refusal: null };
    });
  }

  /**
   * Undo a receipt.
   *
   * Appends a REVERSE row. The RECEIVE it undoes is left exactly as it was — the log is
   * append-only (invariant 2), and a reversal that erased the receipt would destroy the record of
   * who took the paper in.
   */
  async reverse(documentId: string, note?: string): Promise<void> {
    const userId = RequestContext.userId()!;
    const companyId = RequestContext.companyId()!;

    const scoped = this.scope.forActiveCompany();
    const visible = await scoped.findOne(Document, { id: documentId }, { fields: ['id', 'docNo'] });
    if (!visible) {
      throw explained('intake.notFound', {}, 'Document not found in the active company', HttpStatus.NOT_FOUND);
    }

    await this.em.transactional(async (tem) => {
      await tem.findOne(Document, { id: documentId }, { lockMode: LockMode.PESSIMISTIC_WRITE, ...FILTER_OFF });
      if (!(await this.isReceived(documentId, tem))) {
        throw explained(
          'intake.notReceived',
          { docNo: visible.docNo },
          'This document is not currently registered as received',
          HttpStatus.CONFLICT,
        );
      }

      tem.persist(
        tem.create(DocumentIntakeLog, {
          company: tem.getReference(Company, companyId),
          document: tem.getReference(Document, documentId),
          action: IntakeAction.REVERSE,
          actor: tem.getReference(AppUser, userId),
          actedAt: new Date(),
          note,
        }),
      );
    });
  }

  /**
   * Received = the document's latest intake row is a RECEIVE. Derived, never stored.
   *
   * The latest row is picked in JS rather than with `orderBy` + `findOne`: an identical query on
   * the same fork has its normalized FindOptions cached and comes back with the ORDER BY silently
   * dropped from the second call on (the same trap `budget-balance` documents). Here that returned
   * the RECEIVE of a reversed document and refused a legitimate second receipt. The row count per
   * document is tiny — it is one act of receiving a piece of paper — so reading them all costs
   * nothing and cannot be wrong.
   */
  private async isReceived(documentId: string, em: EntityManager): Promise<boolean> {
    const rows = await em.find(DocumentIntakeLog, { document: documentId }, FILTER_OFF);
    return latestOf(rows)?.action === IntakeAction.RECEIVE;
  }

  /** Derived intake state for a page. Delegates to the shared read `DocumentService.list()` uses. */
  stateFor(documentIds: string[], em: EntityManager = this.em): Promise<Map<string, IntakeState>> {
    return intakeStateFor(em, documentIds);
  }
}
