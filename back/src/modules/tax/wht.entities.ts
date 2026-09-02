import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Company } from '../multi-company/multi-company.entities';
import { AppUser } from '../rbac/rbac.entities';
import { Payment } from '../payment-handoff/payment.entities';
import { Vendor } from '../master-data/master-data.entities';
import { TaxCode } from './tax.entities';

/**
 * The evidence a payee needs to claim the tax that was withheld from them.
 *
 * One per PAYMENT, not per document or per vendor-month: `payment.wht_amount` is where the
 * withholding happens, and a payee reconciles deductions one at a time. `payment` is unique, so a
 * payment is certified once as a property of the schema rather than of a check somebody remembers.
 *
 * Never edited after issue. The payee holds a copy, and a document a third party holds is not a
 * draft — a certificate issued in error is corrected by reversing the payment that produced it.
 *
 * `remittance_id` is stamped when the certificate is filed and paid to the authority. What is still
 * owed is then the certificates without one, which is a query rather than a difference between a
 * posted total and a computed one.
 */
@Entity({ tableName: 'wht_certificate' })
@Unique({ properties: ['company', 'certificateNo'] })
@Unique({ properties: ['payment'] })
@Index({ properties: ['company', 'remittanceId'] })
export class WhtCertificate extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => Payment)
  payment!: Payment;

  /** Quoted by the payee to a revenue authority. Unique per company. */
  @Property()
  certificateNo!: string;

  @ManyToOne(() => Vendor, { nullable: true })
  vendor?: Vendor;

  @ManyToOne(() => TaxCode, { nullable: true })
  taxCode?: TaxCode;

  /** Stamped, not looked up later: a rate that changes must not restate an issued certificate. */
  @Property({ type: 'decimal', precision: 9, scale: 6 })
  rate!: string;

  /** The pre-VAT base the withholding was computed on, and the amount withheld. Base currency. */
  @Property({ type: 'decimal', precision: 15, scale: 2 })
  baseAmount!: string;

  @Property({ type: 'decimal', precision: 15, scale: 2 })
  whtAmount!: string;

  @Property({ columnType: 'date' })
  issuedOn!: string;

  @ManyToOne(() => AppUser, { fieldName: 'issued_by', nullable: true })
  issuedBy?: AppUser;

  /** Null until filed and paid. The identity the remittance entry is keyed by. */
  @Property({ type: 'uuid', nullable: true })
  remittanceId?: string;

  @Property({ columnType: 'date', nullable: true })
  remittedOn?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date = new Date();
}

/**
 * The certificate number counter, per company and year.
 *
 * Its own table rather than `doc_running_number`, which is keyed by `document_type` — a certificate
 * is not a document type, and inventing one to borrow the counter would put a row in the document
 * configuration that no document can be created from. The MECHANISM is copied: the row is taken
 * under `LockMode.PESSIMISTIC_WRITE` before it is incremented, which is the rule this repository
 * states for anything that issues a number.
 */
@Entity({ tableName: 'wht_certificate_number' })
@Unique({ properties: ['company', 'year'] })
export class WhtCertificateNumber extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property({ type: 'int' })
  year!: number;

  @Property({ type: 'int' })
  currentNo: number = 0;
}
