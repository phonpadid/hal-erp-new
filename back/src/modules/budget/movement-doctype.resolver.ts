import { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException } from '@nestjs/common';
import type { PostAction } from '@erp/shared';
import { DocumentType } from '../document/document.entities';

// DocumentType is not company-scoped by the global filter (scoped explicitly), so disable it
// and constrain by company in the where clause.
const FILTER_OFF = { filters: { company: false } } as const;

/** post_action values that identify each budget-movement operation (invariant 7: config, not code). */
export { MOVEMENT_POST_ACTIONS } from '@erp/shared';

/**
 * Resolve the document type a budget movement should use for the active company, by its
 * `post_action` (not a hardcoded code). Selection:
 *   0 candidates            → "not configured"
 *   exactly 1               → use it (the common seeded case)
 *   ≥2 and no documentTypeId → ambiguous, caller must choose
 *   documentTypeId given     → must be one of the candidates
 * `label` shapes the error text (e.g. "Adjustment" / "Transfer").
 */
export async function resolveMovementDocType(
  em: EntityManager,
  companyId: string,
  postAction: PostAction,
  documentTypeId: string | undefined,
  label: string,
): Promise<DocumentType> {
  const candidates = await em.find(
    DocumentType,
    { postAction, company: companyId, isActive: true },
    FILTER_OFF,
  );
  if (candidates.length === 0) {
    throw new BadRequestException(
      `${label} document type (post_action ${postAction}) is not configured`,
    );
  }
  if (documentTypeId) {
    const chosen = candidates.find((c) => c.id === documentTypeId);
    if (!chosen) {
      throw new BadRequestException(
        `Selected document type is not a valid ${label.toLowerCase()} type for this company`,
      );
    }
    return chosen;
  }
  if (candidates.length > 1) {
    throw new BadRequestException(
      `Multiple ${label.toLowerCase()} document types are configured — select one`,
    );
  }
  return candidates[0];
}
