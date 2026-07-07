/** Minimal shape the action-gating rule needs. */
export interface ActableDoc {
  status?: string;
  createdBy?: { id?: string } | null;
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
  return doc.createdBy?.id !== userId;
}
