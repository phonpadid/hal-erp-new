import { Collection, Entity, Enum, Index, ManyToOne, OneToMany, Property, Unique } from '@mikro-orm/core';
import { Account } from '../accounting/accounting.entities';
import { AccountRoleType } from '../../common/enums';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { AppUser } from '../rbac/rbac.entities';
import { Company } from '../multi-company/multi-company.entities';

// account_role — maps a system role to an account per company, so the posting engine resolves
// system accounts by role, not by a hardcoded code (invariant 7).
@Entity({ tableName: 'account_role' })
@Unique({ properties: ['company', 'role'] })
export class AccountRole extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Enum({ items: () => AccountRoleType })
  role!: AccountRoleType;

  @ManyToOne(() => Account)
  account!: Account;
}

// journal_entry — APPEND-ONLY double-entry GL header. Balanced (Σdebit = Σcredit across lines)
// and idempotent per source (unique company + source_type + source_id).
@Entity({ tableName: 'journal_entry' })
@Unique({ properties: ['company', 'sourceType', 'sourceId'] })
export class JournalEntry extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property({ columnType: 'date' })
  entryDate!: string;

  @Property()
  sourceType!: string; // e.g. 'PAYMENT'

  @Property({ type: 'uuid' })
  sourceId!: string;

  @Property({ nullable: true })
  memo?: string;

  @ManyToOne(() => AppUser, { fieldName: 'created_by', nullable: true })
  createdBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;

  @OneToMany(() => JournalLine, (l) => l.journalEntry)
  lines = new Collection<JournalLine>(this);
}

// journal_line — APPEND-ONLY. One side of an entry: exactly one of debit/credit is non-zero.
@Entity({ tableName: 'journal_line' })
export class JournalLine extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Index()
  @ManyToOne(() => JournalEntry)
  journalEntry!: JournalEntry;

  @Index()
  @ManyToOne(() => Account)
  account!: Account;

  @Property({ type: 'decimal', precision: 15, scale: 2, defaultRaw: '0' })
  debit: string = '0';

  @Property({ type: 'decimal', precision: 15, scale: 2, defaultRaw: '0' })
  credit: string = '0';

  @Property({ nullable: true })
  memo?: string;
}
