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
 * A fixed number of reads for the whole set — the route steps, the resolver's reads, the holiday
 * calendars — rather than one `routeStep` and one `eligible` per document, which is what the inbox
 * and the aging report used to pay. Usernames are resolved in ONE query afterwards.
 */
export async function pendingRowsFor(
  documents: Document[],
  deps: PendingRowDeps,
  now = new Date(),
): Promise<PendingRow[]> {
  const routed = documents.filter((doc) => doc.workflow);
  const stepOf = await deps.route.currentStepsOf(routed);
  const withStep = routed.filter((doc) => stepOf.has(doc.id));
  const actorsOf = new Map(
    (await deps.resolver.eligibleMany(withStep.map((doc) => ({ step: stepOf.get(doc.id)!, document: doc })))).map(
      (actors, i) => [withStep[i].id, actors],
    ),
  );

  // Both the due time and the time-in-step come from when this step OPENED. Inferring it from
  // the latest approval-log row was wrong for a step reached by escalation (which logs against
  // the step it left) and for the first step of a resubmission.
  const enteredAt = (doc: Document) => stepOf.get(doc.id)?.startedAt ?? doc.submittedAt ?? null;
  const timed = routed.filter((doc) => stepOf.get(doc.id)?.slaHours && enteredAt(doc));
  const dues = await deps.sla.stepDueAtMany(
    timed.map((doc) => ({ stepStart: enteredAt(doc)!, slaHours: stepOf.get(doc.id)!.slaHours!, companyId: doc.company.id })),
  );
  const dueOf = new Map(timed.map((doc, i) => [doc.id, dues[i]]));

  const partial: Array<Omit<PendingRow, 'approvers'> & { approverIds: string[] }> = routed.map((doc) => {
    const step = stepOf.get(doc.id);
    const slaDueAt = dueOf.get(doc.id) ?? null;
    return {
      document: doc,
      currentStepNo: doc.currentStepNo,
      stepName: step?.stepName ?? null,
      approverIds: [...new Set((actorsOf.get(doc.id) ?? []).map((a) => a.userId))],
      enteredStepAt: enteredAt(doc),
      slaDueAt,
      overdue: slaDueAt != null && now > slaDueAt,
    };
  });

  const ids = [...new Set(partial.flatMap((p) => p.approverIds))];
  const users = ids.length ? await deps.em.find(AppUser, { id: { $in: ids } }, FILTER_OFF) : [];
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  return partial.map(({ approverIds, ...rest }) => ({
    ...rest,
    approvers: approverIds.map((id) => ({ userId: id, username: nameById.get(id) ?? id })),
  }));
}
