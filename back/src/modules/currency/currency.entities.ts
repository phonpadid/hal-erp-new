import { Entity, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../common/entities/base.entity';
import { AppUser } from '../rbac/rbac.entities';
import { Company } from '../multi-company/multi-company.entities';

// currency — ISO 4217 master, shared across the whole group. PK is the code.
@Entity({ tableName: 'currency' })
export class Currency {
  @PrimaryKey({ type: 'string', length: 3 })
  code!: string;

  @Property()
  name!: string;

  @Property({ nullable: true })
  symbol?: string;

  // JPY = 0, THB = 2 — drives money rounding on both sides of the wire.
  @Property({ type: 'int', default: 2 })
  decimalPlaces: number = 2;

  @Property({ default: true })
  isActive: boolean = true;
}

// exchange_rate — group-wide (company null) or per-company override.
@Entity({ tableName: 'exchange_rate' })
@Unique({ properties: ['company', 'fromCurrency', 'toCurrency', 'rateDate', 'rateType'] })
export class ExchangeRate extends BaseEntity {
  @ManyToOne(() => Company, { nullable: true })
  company?: Company;

  @ManyToOne(() => Currency, { fieldName: 'from_currency' })
  fromCurrency!: Currency;

  @ManyToOne(() => Currency, { fieldName: 'to_currency' })
  toCurrency!: Currency;

  // 1 unit fromCurrency = rate units toCurrency.
  @Property({ type: 'decimal', precision: 18, scale: 8 })
  rate!: string;

  @Property({ columnType: 'date' })
  rateDate!: string;

  @Property({ default: 'DAILY' })
  rateType: string = 'DAILY';

  @Property({ nullable: true })
  source?: string;

  @ManyToOne(() => AppUser, { fieldName: 'created_by', nullable: true })
  createdBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}
