import { Entity, Enum, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { GlPostingStatus } from '../../common/enums';
import { Company } from '../multi-company/multi-company.entities';

/**
 * gl_posting_attempt — what was tried for one posting source, and what went wrong.
 *
 * A WORK RECORD, not a ledger. Rows change status in place, so this entity is deliberately absent
 * from `LedgerGuardSubscriber`'s APPEND_ONLY list, alongside `pending_successor` and for the same
 * reason.
 *
 * It lives in its own file rather than in `gl.entities.ts` because that file holds a config table
 * and two append-only ledgers, and this is neither.
 *
 * `journal_entry` remains the authority on whether a posting HAPPENED — it is already unique on
 * the same `(company, source_type, source_id)` key. That is what makes this table smaller than the
 * outbox it resembles: `pending_successor` must be written inside the approval transaction because
 * losing the row loses the obligation, whereas losing a row here loses only the error message.
 * The debt itself stays visible as "a settled payment with no entry", which the reconciliation pass
 * finds. That is why nothing outside this module has to write here.
 */
@Entity({ tableName: 'gl_posting_attempt' })
@Unique({ properties: ['company', 'sourceType', 'sourceId'] })
@Index({ properties: ['company', 'status'] })
export class GlPostingAttempt extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  /** Same values as `journal_entry.source_type`: PAYMENT / APPROVAL_ACCRUAL / … */
  @Property()
  sourceType!: string;

  @Property({ type: 'uuid' })
  sourceId!: string;

  @Enum({ items: () => GlPostingStatus })
  status: GlPostingStatus = GlPostingStatus.PENDING;

  @Property({ type: 'int' })
  attempts: number = 0;

  /** Kept across a re-queue, so the record of what went wrong survives the retry. */
  @Property({ type: 'text', nullable: true })
  lastError?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  lastAttemptAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();

  @Property({ columnType: 'timestamptz', nullable: true, onUpdate: () => new Date() })
  updatedAt?: Date = new Date();
}
