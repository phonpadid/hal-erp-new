import type { EntityManager } from '@mikro-orm/postgresql';
import type { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import type { ApproverResolverService } from './approver-resolver.service';
import type { DocumentRouteService } from './document-route.service';
import type { SlaService } from './sla.service';

const FILTER_OFF = { filters: { company: false } } as const;

/**
 * What one `IN_APPROVAL` document is waiting on — the per-document computation the aging report
 * and the pending summary both need, so it lives in one place and the two cannot disagree about
 * who a document waits on. Everything here is what the route recorded and what the resolver
 * answers; nothing is inferred from the approval log.
 */
export interface PendingRow {
  document: Document;
  currentStepNo: number;
  stepName: string | null;
  /** The eligible approvers of the current step, as the resolver answers for acting (invariant 8). */
  approvers: Array<{ userId: string; username: string }>;
  /** When the current step opened: the route step's `startedAt`, else the submit instant. */
  enteredStepAt: Date | null;
  slaDueAt: Date | null;
  overdue: boolean;
}

export interface PendingRowDeps {
  em: EntityManager;
  route: DocumentRouteService;
  resolver: ApproverResolverService;
  sla: SlaService;
}

/**
 * Rows for every document given that has a workflow. `documents` must arrive with `company` and
 * `createdBy` populated (the resolver reads both) and already bounded to what the caller may see
 * — this function narrows nothing.
 *
 * One `routeStep` and one `eligible` per document, as the inbox and the aging report have always
 * paid; usernames are resolved in ONE query for the whole set afterwards.
 */
export async function pendingRowsFor(
  documents: Document[],
  deps: PendingRowDeps,
  now = new Date(),
): Promise<PendingRow[]> {
  const partial: Array<Omit<PendingRow, 'approvers'> & { approverIds: string[] }> = [];
  for (const doc of documents) {
    if (!doc.workflow) continue;
    const step = await deps.route.routeStep(doc.id, doc.currentStepNo);
    const actors = step ? await deps.resolver.eligible(step, doc) : [];

    // Both the due time and the time-in-step come from when this step OPENED. Inferring it from
    // the latest approval-log row was wrong for a step reached by escalation (which logs against
    // the step it left) and for the first step of a resubmission.
    const enteredStepAt = step?.startedAt ?? doc.submittedAt ?? null;
    let slaDueAt: Date | null = null;
    if (step?.slaHours && enteredStepAt) {
      slaDueAt = await deps.sla.stepDueAt(enteredStepAt, step.slaHours, doc.company.id);
    }

    partial.push({
      document: doc,
      currentStepNo: doc.currentStepNo,
      stepName: step?.stepName ?? null,
      approverIds: [...new Set(actors.map((a) => a.userId))],
      enteredStepAt,
      slaDueAt,
      overdue: slaDueAt != null && now > slaDueAt,
    });
  }

  const ids = [...new Set(partial.flatMap((p) => p.approverIds))];
  const users = ids.length ? await deps.em.find(AppUser, { id: { $in: ids } }, FILTER_OFF) : [];
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  return partial.map(({ approverIds, ...rest }) => ({
    ...rest,
    approvers: approverIds.map((id) => ({ userId: id, username: nameById.get(id) ?? id })),
  }));
}
