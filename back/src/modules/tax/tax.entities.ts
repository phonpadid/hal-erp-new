import { Entity, Enum, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { TaxKind } from '../../common/enums';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';

// tax_code — per-company purchase tax master. VAT this slice; WHT reserved for a follow-up.
@Entity({ tableName: 'tax_code' })
@Unique({ properties: ['company', 'code'] })
export class TaxCode extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  code!: string;

  @Property()
  name!: string;

  @Enum({ items: () => TaxKind })
  kind!: TaxKind;

  // Rate as a decimal fraction, e.g. '0.070000'. Carried as a string (money/rate rule).
  @Property({ type: 'decimal', precision: 9, scale: 6 })
  rate!: string;

  @Property({ default: true })
  isActive: boolean = true;
}
