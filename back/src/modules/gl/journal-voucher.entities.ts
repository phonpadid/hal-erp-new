import { Entity, Enum, Index, ManyToOne, OneToMany, Collection, Property } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Account } from '../accounting/accounting.entities';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';

export enum JournalVoucherStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

/**
 * A journal voucher awaiting a second pair of eyes.
 *
 * This header exists because an approval step needs somewhere to hold an entry that is not yet an
 * entry, and `journal_entry` is append-only — it cannot carry a pending state, and posting first
 * and reversing on rejection would leave unapproved entries in the ledger permanently, which is
 * exactly what the control prevents. `gl_posting_attempt` is not the place either: that table holds
 * postings the SYSTEM owes itself and the period close reads it to decide whether a month is
 * drained, so a voucher waiting on a person would make a close wait on human work.
 *
 * It is not a duplicate of the entry. The entry is created FROM the voucher, once, and never
 * edited; the voucher's id IS the entry's `source_id`, so the two are one record in two states.
 *
 * `created_by` is the person who prepared it and becomes the ENTRY's author. `approved_by` is a
 * control event about that entry rather than authorship of it, which is why it stays here and not
 * on `journal_entry`.
 */
@Entity({ tableName: 'journal_voucher' })
@Index({ properties: ['company', 'status'] })
export class JournalVoucher extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  /** The accounting date the preparer stated. NOT the date a checker got to it. */
  @Property({ columnType: 'date' })
  entryDate!: string;

  @Property()
  memo!: string;

  @Enum({ items: () => JournalVoucherStatus })
  status: JournalVoucherStatus = JournalVoucherStatus.PENDING;

  /**
   * Set when this voucher is a REVERSAL: the entry whose lines were computed into it. A reversal is
   * a voucher whose lines were computed for the submitter rather than typed by them, so it takes
   * the same path and the same checker.
   */
  @Property({ type: 'uuid', nullable: true })
  reversesEntryId?: string;

  @ManyToOne(() => AppUser, { fieldName: 'created_by' })
  createdBy!: AppUser;

  @ManyToOne(() => AppUser, { fieldName: 'decided_by', nullable: true })
  decidedBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  decidedAt?: Date;

  /** Required on a rejection. A refusal that costs a sentence is one somebody can act on. */
  @Property({ type: 'text', nullable: true })
  rejectReason?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();

  @OneToMany(() => JournalVoucherLine, (l) => l.voucher)
  lines = new Collection<JournalVoucherLine>(this);
}

@Entity({ tableName: 'journal_voucher_line' })
export class JournalVoucherLine extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Index()
  @ManyToOne(() => JournalVoucher)
  voucher!: JournalVoucher;

  @ManyToOne(() => Account)
  account!: Account;

  @Property({ type: 'decimal', precision: 15, scale: 2, defaultRaw: '0' })
  debit: string = '0';

  @Property({ type: 'decimal', precision: 15, scale: 2, defaultRaw: '0' })
  credit: string = '0';

  @Property({ nullable: true })
  memo?: string;
}
