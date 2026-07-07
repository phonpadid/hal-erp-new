import { EntityRepository } from '@mikro-orm/postgresql';
import type { FilterQuery } from '@mikro-orm/core';

/**
 * Repository for append-only ledgers (budget_txn, approval_log). Exposes
 * insert + read only; update/delete throw. Pair with LedgerGuardSubscriber.
 */
export class AppendOnlyRepository<T extends object> extends EntityRepository<T> {
  private blocked(op: string): never {
    throw new Error(
      `${this.entityName.toString()} is append-only; ${op} is not allowed`,
    );
  }

  /** Blocks UPDATE through the repository (corrections are new rows). */
  override nativeUpdate(): Promise<number> {
    return this.blocked('nativeUpdate');
  }

  /** Blocks DELETE through the repository. */
  override nativeDelete(_where: FilterQuery<T>): Promise<number> {
    return this.blocked('nativeDelete');
  }
}
