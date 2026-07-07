import { Entity, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { TaxCode } from '../tax/tax.entities';

/**
 * payment — one record per settled disbursement, capturing the FX breakdown between the
 * locked rate (stamped on the document at submit) and the actual paid rate. It is NOT a
 * budget ledger row: the FX delta goes to accounting (the `payment.settled` event), never to
 * `budget_txn` (invariant 6). One payment per disbursement (unique on document).
 */
@Entity({ tableName: 'payment' })
@Unique({ properties: ['document'] })
export class Payment extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Document)
  document!: Document;

  // 1 unit of document currency = rate units of base currency.
  @Property({ type: 'decimal', precision: 18, scale: 8 })
  lockedRate!: string;

  @Property({ type: 'decimal', precision: 18, scale: 8 })
  actualRate!: string;

  // Base-currency amounts: at the locked rate (= the budget basis) and at the actual rate.
  @Property({ type: 'decimal', precision: 15, scale: 2 })
  baseLocked!: string;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  baseActual!: string;

  // base_actual − base_locked. Positive = LOSS (paid more base), negative = GAIN.
  @Property({ type: 'decimal', precision: 15, scale: 2 })
  fxDelta!: string;

  @Property()
  fxKind!: string; // GAIN / LOSS / NONE

  // Withholding tax deducted at payment (on the pre-VAT net base). Vendor is paid
  // base_actual − wht_amount; the difference is a WHT_PAYABLE liability in the GL.
  @Property({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  whtAmount?: string;

  @ManyToOne(() => TaxCode, { fieldName: 'wht_tax_code_id', nullable: true })
  whtTaxCode?: TaxCode;

  @ManyToOne(() => AppUser, { fieldName: 'created_by', nullable: true })
  createdBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  paidAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}
