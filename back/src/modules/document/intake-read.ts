import type { EntityManager } from '@mikro-orm/postgresql';
import { ApproveAction, IntakeAction } from '../../common/enums';
import { ApprovalLog, DocumentApprovalStep, DocumentApprovalStepActor } from '../approval/approval.entities';
import { AppUser, Employee } from '../rbac/rbac.entities';
import { DocumentIntakeLog } from './document.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** A document's derived intake state. Never stored — always read from the log. */
export interface IntakeState {
  received: boolean;
  /** Who received it, and when. Both null unless `received`. */
  receivedByName: string | null;
  receivedAt: Date | null;
  /**
   * Whether the reader may register receipt of this document RIGHT NOW — it has been at their
   * desk and is not already received.
   *
   * On the row because the screen cannot work it out: reachability is a routing fact the client
   * has no access to, so without it the list drew a receive button on every unreceived row and
   * the server refused most of them. A button that is always refused is worse than no button.
   */
  canReceive: boolean;
}

export const NOT_RECEIVED: IntakeState = Object.freeze({
  received: false,
  receivedByName: null,
  receivedAt: null,
  canReceive: false,
});

/**
 * The last act on a document.
 *
 * Every row is written under the document's row lock, so two acts on one document are already
 * serialised in time and `acted_at` totally orders them in practice. Ties are broken by nothing on
 * purpose: a tie needs two different users acting on one document inside the same millisecond, and
 * either answer is a state the next act corrects.
 *
 * Picked in JS rather than with `orderBy` + `findOne`: an identical query on the same fork has its
 * normalized FindOptions cached and comes back with the ORDER BY silently dropped from the second
 * call on (the trap `budget-balance` documents). Here that returned the RECEIVE of a reversed
 * document and refused a legitimate second receipt.
 */
export function latestOf(rows: DocumentIntakeLog[]): DocumentIntakeLog | undefined {
  return rows.reduce<DocumentIntakeLog | undefined>(
    (best, row) => (!best || row.actedAt > best.actedAt ? row : best),
    undefined,
  );
}

/**
 * Derived intake state for a set of documents, in a bounded number of queries.
 *
 * A standalone function rather than a method so `DocumentService.list()` can use it without taking
 * the intake service as a constructor dependency — dozens of unit tests build that service
 * positionally, and an eighth argument would break call sites that never touch intake.
 */
export async function intakeStateFor(
  em: EntityManager,
  documentIds: string[],
  /** The reader, when `canReceive` is wanted. Omitted for a caller who cannot receive anything. */
  viewerId?: string,
): Promise<Map<string, IntakeState>> {
  const out = new Map<string, IntakeState>();
  if (!documentIds.length) return out;

  const reached = viewerId ? await reachedBy(em, documentIds, viewerId) : new Set<string>();

  const rows = await em.find(DocumentIntakeLog, { document: { $in: documentIds } }, FILTER_OFF);

  const byDoc = new Map<string, DocumentIntakeLog[]>();
  for (const row of rows) {
    const list = byDoc.get(row.document.id);
    if (list) list.push(row);
    else byDoc.set(row.document.id, [row]);
  }

  const latestByDoc = new Map<string, DocumentIntakeLog>();
  for (const [docId, list] of byDoc) latestByDoc.set(docId, latestOf(list)!);

  const receipts = [...latestByDoc.values()].filter((r) => r.action === IntakeAction.RECEIVE);
  const nameOf = await namesFor(
    em,
    [...new Set(receipts.map((r) => r.actor.id))],
    [...new Set(receipts.map((r) => r.company.id))],
  );

  for (const id of documentIds) {
    const latest = latestByDoc.get(id);
    if (latest?.action !== IntakeAction.RECEIVE) {
      // Not received — so it can be, if it has been at this reader's desk.
      out.set(id, { ...NOT_RECEIVED, canReceive: reached.has(id) });
      continue;
    }
    out.set(id, {
      received: true,
      receivedByName: nameOf.get(latest.actor.id) ?? null,
      receivedAt: latest.actedAt,
      // Already received: the server refuses a second receipt, so the screen must not offer one.
      canReceive: false,
    });
  }
  return out;
}

/**
 * Which of these documents have been at this reader's desk.
 *
 * The page-wide form of `DocumentIntakeService.hasReached`, and the same two sources: a live route
 * step naming them, or an action of theirs on the append-only approval trail (never a `CANCEL` —
 * that is the requester withdrawing their own document, not a reviewer the route delivered it to).
 *
 * Three queries for any page size. Resolving it per row would cost three each, on a read the
 * list performs on every page turn.
 */
export async function reachedBy(
  em: EntityManager,
  documentIds: string[],
  userId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!documentIds.length) return out;

  // The live steps of these documents first, then the actor rows against them. Reading the
  // document id back off a populated `step` does not survive a filtered join here — the relation
  // comes back unset — so the mapping is built explicitly from rows this function loaded itself.
  const steps = await em.find(
    DocumentApprovalStep,
    { document: { $in: documentIds }, supersededAt: null },
    FILTER_OFF,
  );
  const documentOfStep = new Map(steps.map((step) => [step.id, step.document.id]));
  if (steps.length) {
    const named = await em.find(
      DocumentApprovalStepActor,
      { user: userId, step: { $in: [...documentOfStep.keys()] } },
      FILTER_OFF,
    );
    for (const row of named) {
      const documentId = documentOfStep.get(row.step.id);
      if (documentId) out.add(documentId);
    }
  }

  const acted = await em.find(
    ApprovalLog,
    { document: { $in: documentIds }, approver: userId, action: { $ne: ApproveAction.CANCEL } },
    { fields: ['document'], ...FILTER_OFF },
  );
  for (const row of acted) out.add(row.document.id);

  return out;
}

/** Employee full name within one of the given companies, else the username. Two queries, never one per row. */
async function namesFor(
  em: EntityManager,
  userIds: string[],
  companyIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;

  const users = await em.find(AppUser, { id: { $in: userIds } }, FILTER_OFF);
  for (const u of users) out.set(u.id, u.username);

  if (companyIds.length) {
    const employees = await em.find(
      Employee,
      { user: { $in: userIds }, company: { $in: companyIds } },
      { populate: ['user'], ...FILTER_OFF },
    );
    for (const e of employees) if (e.user && e.fullName) out.set(e.user.id, e.fullName);
  }
  return out;
}
