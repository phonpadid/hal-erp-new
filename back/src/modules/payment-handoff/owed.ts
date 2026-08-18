import type { EntityManager } from '@mikro-orm/postgresql';
import { DocStatus } from '../../common/enums';
import { Document } from '../document/document.entities';
import { accruedPayablesOf, type AccruedPayable } from '../gl/payables';
import { Payment, PaymentBatchLine } from './payment.entities';

const FILTER_OFF = { filters: { company: false } } as const;

/** Batch states that still hold their payables — a terminal batch releases them again. */
export const OPEN_BATCH_STATUSES = ['DRAFT', 'EXPORTED'] as const;

/** One document the company owes and has not paid. */
export interface OwedDocument {
  document: Document;
  /** Present when an approval accrual booked the obligation; absent for a pay-as-you-go type. */
  accrued?: AccruedPayable;
}

/**
 * Everything the company owes and has not paid — the ONE predicate (design D3).
 *
 * ```
 * owed = COMPLETED
 *        AND ( an approval accrual credited a payable account      ← the ledger's answer
 *              OR documentType.post_action = 'CUT_BUDGET' )        ← the configuration's answer
 *        AND no payment record
 *        AND no DRAFT or EXPORTED batch holds it
 * ```
 *
 * Both clauses are needed and neither subsumes the other. A claim recognises its obligation at
 * approval and its type's post-action says nothing about who is owed, so only the ledger can speak
 * for it. A `CUT_BUDGET` type that does not accrue books nothing until it is paid — the seeded `PR`
 * is one — so there is no accrual to read and only the configuration can speak for it.
 *
 * What removes the defect is that there is ONE predicate, not that it reads one source: the queue
 * and the record endpoint both call this, so the queue can never offer an action the endpoint
 * refuses. Two queries over two flags is what shipped before, and what could disagree — the
 * settlements queue listed by `accrues_on_approval` while ready-to-pay listed by `post_action`, so
 * a type that was both appeared in both and could only be acted on in one.
 *
 * `scoped` must be an EM already scoped to the active company (invariant 1).
 */
export async function owedDocuments(
  scoped: EntityManager,
  em: EntityManager,
  companyId: string,
  documentIds?: string[],
): Promise<OwedDocument[]> {
  const where: Record<string, unknown> = { status: DocStatus.COMPLETED };
  if (documentIds) {
    if (!documentIds.length) return [];
    where.id = { $in: documentIds };
  }
  const completed = await scoped.find(Document, where, {
    populate: ['documentType', 'vendor', 'vendorBankAccount', 'relatedEmployee'],
  });
  if (!completed.length) return [];

  const accrued = await accruedPayablesOf(
    em,
    companyId,
    completed.map((d) => d.id),
  );
  const owed = completed.filter(
    (d) => accrued.has(d.id) || d.documentType.postAction === 'CUT_BUDGET',
  );
  if (!owed.length) return [];

  const ids = owed.map((d) => d.id);
  const paid = await em.find(Payment, { document: { $in: ids } }, FILTER_OFF);
  const paidIds = new Set(paid.map((p) => p.document.id));

  // Held by an open batch: what stops one payable reaching the bank on two files. The unique
  // constraint on `payment.document_id` would catch the double only at import, after the money moved.
  const held = await em.find(
    PaymentBatchLine,
    { document: { $in: ids }, batch: { status: { $in: [...OPEN_BATCH_STATUSES] } } },
    FILTER_OFF,
  );
  const heldIds = new Set(held.map((l) => l.document.id));

  return owed
    .filter((d) => !paidIds.has(d.id) && !heldIds.has(d.id))
    .map((d) => ({ document: d, accrued: accrued.get(d.id) }));
}
