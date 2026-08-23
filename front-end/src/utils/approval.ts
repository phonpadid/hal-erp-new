/**
 * Minimal shape the action-gating rule needs.
 *
 * `createdBy` accepts a bare id as well as the populated object: an ORM relation that nobody
 * remembered to populate serializes as the id STRING, and reading `.id` off a string yields
 * undefined — which this rule would read as "not the creator" and wave the creator through.
 * The rule must fail CLOSED on a shape it does not recognise, not open.
 */
export interface ActableDoc {
  status?: string;
  createdBy?: { id?: string } | string | null;
}

/** The creator's id, whichever of the two shapes the read handed us. */
export function creatorId(createdBy: ActableDoc['createdBy']): string | undefined {
  return typeof createdBy === 'string' ? createdBy : (createdBy?.id ?? undefined);
}

/** One pending approver as returned by the pending-approvers read. */
export interface PendingApproverLike {
  name: string;
  delegatedFrom?: string;
}

/**
 * Human-readable list of the approvers a document is waiting on. A delegate is annotated with
 * the principal they act for, using the caller-supplied `viaDelegation` translator so the
 * string stays localizable. Pure so it can be unit-tested without mounting the detail view.
 */
export function pendingApproverNames(
  approvers: PendingApproverLike[],
  viaDelegation: (name: string) => string,
): string[] {
  return approvers.map((a) => (a.delegatedFrom ? `${a.name} (${viaDelegation(a.delegatedFrom)})` : a.name));
}

/**
 * Whether the signed-in user may act on a document (UX mirror of invariant 8 — the server
 * still enforces): it must be in approval, the user must hold DOC_APPROVE, and the user must
 * not be its creator.
 */
export function canActOn(
  doc: ActableDoc | null | undefined,
  userId: string | null | undefined,
  can: (code: string) => boolean,
): boolean {
  if (!doc || doc.status !== 'IN_APPROVAL') return false;
  if (!can('DOC_APPROVE')) return false;
  const creator = creatorId(doc.createdBy);
  // No creator on the read means the mirror cannot answer the question. Withhold the buttons
  // rather than guess — the server is the one that enforces invariant 8, and it will refuse.
  if (!creator) return false;
  return creator !== userId;
}
