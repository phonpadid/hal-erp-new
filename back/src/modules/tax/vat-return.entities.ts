import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';

/**
 * A VAT return filed for a period.
 *
 * Filing moves input VAT from "tax paid on purchases" to "a debt the revenue authority owes us" —
 * different assets, and the move between them IS the filing. The row records which period was
 * claimed and how much, so a second return for the same month is refusable rather than merely
 * unlikely: it would credit `VAT_INPUT` twice for one claim.
 *
 * The row's id is the entry's `source_id`, so a retried filing resolves to the entry already
 * written.
 */
@Entity({ tableName: 'vat_return' })
@Unique({ properties: ['company', 'periodFrom', 'periodTo'] })
@Index({ properties: ['company', 'filedOn'] })
export class VatReturn extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property({ columnType: 'date' })
  periodFrom!: string;

  @Property({ columnType: 'date' })
  periodTo!: string;

  /** The period's net movement on `VAT_INPUT`, read from the ledger at the moment of filing. */
  @Property({ type: 'decimal', precision: 15, scale: 2 })
  inputVat!: string;

  @Property({ columnType: 'date' })
  filedOn!: string;

  @ManyToOne(() => AppUser, { fieldName: 'filed_by', nullable: true })
  filedBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();
}
