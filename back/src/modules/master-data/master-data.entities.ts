import { Entity, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity, CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';

// vendor — central master, enabled per company via vendor_company.
@Entity({ tableName: 'vendor' })
export class Vendor extends BaseEntity {
  @Property({ unique: true })
  vendorCode!: string;

  @Property()
  name!: string;

  @Property({ length: 13, nullable: true })
  taxId?: string;

  @Property({ nullable: true })
  address?: string;

  @Property({ nullable: true })
  contactName?: string;

  @Property({ nullable: true })
  contactPhone?: string;

  @Property({ type: 'int', default: 30 })
  paymentTermDays: number = 30;

  @Property({ default: true })
  isActive: boolean = true;
}

@Entity({ tableName: 'vendor_company' })
@Unique({ properties: ['vendor', 'company'] })
export class VendorCompany extends CompanyScopedEntity {
  @ManyToOne(() => Vendor)
  vendor!: Vendor;

  @ManyToOne(() => Company)
  company!: Company;

  @Property({ default: true })
  isActive: boolean = true;

  @Property({ columnType: 'date', nullable: true })
  approvedDate?: string;

  // Per-company override of the group vendor's payment terms; null = use vendor.paymentTermDays.
  @Property({ type: 'int', nullable: true })
  paymentTermDays?: number;
}

// item — central master, enabled per company via item_company.
@Entity({ tableName: 'item' })
export class Item extends BaseEntity {
  @Property({ unique: true })
  itemCode!: string;

  @Property()
  name!: string;

  @Property({ nullable: true })
  category?: string;

  @Property({ nullable: true })
  defaultUnit?: string;

  @Property({ default: true })
  isActive: boolean = true;
}

@Entity({ tableName: 'item_company' })
@Unique({ properties: ['item', 'company'] })
export class ItemCompany extends CompanyScopedEntity {
  @ManyToOne(() => Item)
  item!: Item;

  @ManyToOne(() => Company)
  company!: Company;

  @Property({ default: true })
  isActive: boolean = true;

  // The item's GL for this company (validated against the company chart on enable); null = unset.
  @Property({ nullable: true })
  defaultGlAccount?: string;
}
