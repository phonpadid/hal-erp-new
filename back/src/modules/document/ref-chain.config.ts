import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { settlesBudget } from '@erp/shared';
import { DocumentType, DocumentTypeRef } from './document.entities';

/**
 * Allowed predecessor→successor document-type pairings for the reference chain
 * (PR→PO, PROC→PO, PO→DISB, ADVANCE→CLEAR_ADVANCE) are stored per company in the
 * `document_type_ref` table — configuration, not per-type branching logic (invariant 7),
 * and scoped by company (invariant 1). These helpers resolve pairings by document-type **id**
 * (both call sites already hold the loaded types, so this also sidesteps the populate-stub
 * pitfall of relying on a related type's `code`). `document_type_ref` is not a
 * CompanyScopedEntity, so queries filter `company` explicitly.
 */

/**
 * Whether the active company permits creating a `successorTypeId` document from a
 * `predecessorTypeId` predecessor — i.e. a matching `document_type_ref` row exists.
 */
export async function isRefPairingAllowed(
  em: EntityManager,
  companyId: string,
  predecessorTypeId: string,
  successorTypeId: string,
): Promise<boolean> {
  const pairing = await em.findOne(DocumentTypeRef, {
    company: companyId,
    predecessorType: predecessorTypeId,
    successorType: successorTypeId,
  });
  return pairing !== null;
}

/**
 * Successor document types that may be created from a predecessor of `predecessorTypeId` in the
 * active company (the paired successors, regardless of active state — the caller decides).
 * Used by create-from validation.
 */
export async function successorTypesFor(
  em: EntityManager,
  companyId: string,
  predecessorTypeId: string,
): Promise<DocumentType[]> {
  const pairings = await em.find(
    DocumentTypeRef,
    { company: companyId, predecessorType: predecessorTypeId },
    { populate: ['successorType'] },
  );
  return pairings.map((p) => p.successorType);
}

/**
 * Pairings the CREATE_SUCCESSOR post-action should auto-create for a predecessor of
 * `predecessorTypeId` in the active company — those marked `auto_create=true` (zero, one, or many).
 * Pairings with `auto_create=false` are for manual create-from only.
 *
 * Returns the pairing rows rather than their `successorType`s: the caller needs each pairing's
 * `successorDepartment` too (null = the source document's own department), and dropping to a bare
 * type list would throw that away.
 */
export async function autoCreateSuccessorsFor(
  em: EntityManager,
  companyId: string,
  predecessorTypeId: string,
): Promise<DocumentTypeRef[]> {
  return em.find(
    DocumentTypeRef,
    { company: companyId, predecessorType: predecessorTypeId, autoCreate: true },
    {
      populate: ['successorType', 'successorDepartment'],
      // `successorDepartment` is company-scoped, so populating it would arm the `company` filter —
      // which has no arguments here: this runs inside the approval transaction, not a request. The
      // `company: companyId` term above is the scope (invariant 1), and the department is validated
      // to be of that same company when the pairing is written.
      filters: { company: false },
    },
  );
}

/**
 * Whether a reservation taken by `typeId` could ever be settled, in this company's configuration.
 *
 * True when the type settles its own reservation, or when the `document_type_ref` pairings lead
 * from it to an active type that does. A reservation reduces the budget's available balance the
 * moment it is taken and is only given back by a RELEASE or converted by an ACTUAL (invariant 3);
 * a type with no route to either consumes the appropriation permanently while recognising nothing,
 * and `budget_txn` is append-only (invariant 2) so it cannot be undone afterwards.
 *
 * The walk is over the whole graph rather than direct pairings, because a settlement can be several
 * documents away — a requisition reaches its disbursement through an order. `auto_create` is
 * ignored: a pairing marked for manual create-from is still a route a settlement arrives by, and is
 * in fact how a DISB is raised against a PO.
 *
 * Only active types are traversed. A type nobody can raise is not a route, which is the same reason
 * `autoCreateSuccessorsFor` filters on `successorType.isActive`.
 *
 * `seen` makes the walk terminate: nothing forbids a cycle in `document_type_ref`, and the naive
 * recursion would not return on one.
 */
export async function reservationCanBeSettled(
  em: EntityManager,
  companyId: string,
  type: Pick<DocumentType, 'id' | 'postAction'>,
): Promise<boolean> {
  if (settlesBudget(type.postAction)) return true;

  const seen = new Set<string>([type.id]);
  let frontier = [type.id];
  while (frontier.length) {
    const pairings = await em.find(
      DocumentTypeRef,
      { company: companyId, predecessorType: { $in: frontier } },
      { populate: ['successorType'], filters: { company: false } },
    );
    const next: string[] = [];
    for (const pairing of pairings) {
      const successor = pairing.successorType;
      if (!successor.isActive || seen.has(successor.id)) continue;
      if (settlesBudget(successor.postAction)) return true;
      seen.add(successor.id);
      next.push(successor.id);
    }
    frontier = next;
  }
  return false;
}

/**
 * Refuse a configuration in which `type` reserves budget with nowhere for the reservation to go.
 *
 * A free function rather than a service method: three different services need it — the type
 * registry, the department mapping, and the pairing admin — and threading one service into the
 * other two would make each of them know about the others to ask one question about a graph.
 *
 * Only binds while the type is active. An inactive type raises no documents and so reserves nothing.
 */
export async function assertReservationCanBeSettled(
  em: EntityManager,
  companyId: string,
  type: Pick<DocumentType, 'id' | 'code' | 'postAction' | 'requiresBudget' | 'isActive'>,
): Promise<void> {
  if (!type.isActive || !type.requiresBudget) return;
  if (await reservationCanBeSettled(em, companyId, type)) return;
  throw new BadRequestException(
    `Document type '${type.code}' reserves budget with no way to settle it: it has no settling post-action, and no reference pairing leads from it to an active type that settles. Its reservations would reduce the budget permanently and never be recognised.`,
  );
}

/**
 * Refuse a write that would leave ANY active reserving type in the company without a settlement.
 * The graph breaks from either end — removing a pairing, or deactivating the type a path ends at —
 * and the write that breaks it is the last place the cause is still visible.
 *
 * The same question `budgetsStrandedByDeactivating` asks before deactivating a control point, about
 * a different resource. Bounded and cheap: the reference configuration has nineteen types and three
 * pairings.
 */
export async function assertNoReservingTypeStranded(
  em: EntityManager,
  companyId: string,
): Promise<void> {
  const reserving = await em.find(DocumentType, {
    company: companyId,
    isActive: true,
    requiresBudget: true,
  });
  for (const type of reserving) {
    if (await reservationCanBeSettled(em, companyId, type)) continue;
    throw new BadRequestException(
      `This would leave document type '${type.code}' reserving budget with no way to settle it. Give it a settling post-action, or keep a reference pairing from it to a type that settles, before making this change.`,
    );
  }
}
