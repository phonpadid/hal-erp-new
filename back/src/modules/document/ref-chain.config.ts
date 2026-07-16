import type { EntityManager } from '@mikro-orm/postgresql';
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
 * Successor document types the CREATE_SUCCESSOR post-action should auto-create for a predecessor of
 * `predecessorTypeId` in the active company — the successors of pairings marked `auto_create=true`
 * (zero, one, or many). Pairings with `auto_create=false` are for manual create-from only.
 */
export async function autoCreateSuccessorsFor(
  em: EntityManager,
  companyId: string,
  predecessorTypeId: string,
): Promise<DocumentType[]> {
  const pairings = await em.find(
    DocumentTypeRef,
    { company: companyId, predecessorType: predecessorTypeId, autoCreate: true },
    { populate: ['successorType'] },
  );
  return pairings.map((p) => p.successorType);
}
