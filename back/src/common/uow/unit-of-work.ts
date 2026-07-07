import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';

/**
 * Concurrency conventions for budget/quota/document-numbering work.
 *
 * RULE (CLAUDE.md): any unit of work that writes budget_txn or quota_usage must
 * run inside a single em.transactional() so paired rows commit atomically, and
 * any row that gates over-commit (budget) or duplicate doc numbers
 * (doc_running_number) must be read under LockMode.PESSIMISTIC_WRITE
 * (SELECT FOR UPDATE).
 */

/** Run `work` in one transaction (one Unit of Work → atomic flush). */
export function inTransaction<T>(
  em: EntityManager,
  work: (tem: EntityManager) => Promise<T>,
): Promise<T> {
  return em.transactional((tem) => work(tem as EntityManager));
}

/**
 * Read a single row FOR UPDATE inside the current transaction. Use before
 * incrementing doc_running_number.current_no or reserving against a budget so
 * concurrent requests serialize instead of over-committing / duplicating numbers.
 */
export function lockForUpdate<T extends object>(
  tem: EntityManager,
  entity: { new (...args: any[]): T },
  where: FilterQuery<T>,
  options: { filters?: Record<string, boolean> } = {},
): Promise<T | null> {
  return tem.findOne(entity, where, {
    lockMode: LockMode.PESSIMISTIC_WRITE,
    ...options,
  });
}
