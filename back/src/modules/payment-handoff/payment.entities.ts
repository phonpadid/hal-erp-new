import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { CompanyScopedEntity } from '../../common/entities/base.entity';
import { Money } from '../../common/money/money';
import { BankAccount } from './bank-account.entities';
import { Company } from '../multi-company/multi-company.entities';
import { Document } from '../document/document.entities';
import { AppUser } from '../rbac/rbac.entities';
import { TaxCode } from '../tax/tax.entities';

// Declaration order matters here: `Payment` carries a `@ManyToOne(() => PaymentBatch)`, and
// SWC's emitDecoratorMetadata evaluates the referenced class when `Payment` is defined — not
// lazily like the arrow. PaymentBatch therefore has to be defined first, or importing this
// module throws "Cannot access 'PaymentBatch' before initialization".
/**
 * payment_batch — one payment run: pick payables off the ready-to-pay queue, export a file for the
 * bank, upload the bank's result, record the payments.
 *
 * Writes no `budget_txn` anywhere in its lifecycle. The budget was already settled to ACTUAL when
 * the CUT_BUDGET document completed; touching it again here would charge the budget twice
 * (invariant 3), and the FX delta found at import belongs to accounting, not to the budget's locked
 * basis (invariant 6).
 */
@Entity({ tableName: 'payment_batch' })
@Index({ properties: ['company', 'status'] })
export class PaymentBatch extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Property()
  status: string = 'DRAFT'; // DRAFT / EXPORTED / COMPLETED / PARTIAL / CANCELLED

  // Selects the BankFileFormatter. An unknown value is rejected at export rather than falling back
  // to a default — silently sending the wrong layout to a bank is worse than not sending.
  @Property()
  format: string = 'CSV';

  @Property({ columnType: 'date', nullable: true })
  payDate?: string;

  // Object key of the exact bytes sent to the bank. Stored so a re-download returns the same file
  // rather than re-rendering one that a later edit might have changed.
  @Property({ nullable: true })
  filePath?: string;

  @Property({ columnType: 'timestamptz', nullable: true })
  exportedAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  importedAt?: Date;

  /**
   * The company account this run draws on. A batch is one file sent to one bank from one account,
   * so the account belongs to the run — decided when it is built and unchanged afterwards, like its
   * format and its pay date.
   *
   * Optional: a company that has not configured its bank accounts must still be able to pay. Its
   * batches behave as they did before, and their payments appear in the unattributed reconciliation
   * read rather than being lost.
   */
  @ManyToOne(() => BankAccount, { fieldName: 'bank_account_id', nullable: true })
  bankAccount?: BankAccount;

  @ManyToOne(() => AppUser, { fieldName: 'created_by', nullable: true })
  createdBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  updatedAt?: Date;
}

/**
 * payment_batch_line — one payable in a run.
 *
 * The payee details are SNAPSHOT at DRAFT time, not joined live: a later edit to
 * `vendor_bank_account` must not rewrite what an exported batch says, or the stored file and the
 * database would disagree and the artifact would stop being evidence.
 */
@Entity({ tableName: 'payment_batch_line' })
@Unique({ properties: ['batch', 'document'] })
@Index({ properties: ['batch'] })
export class PaymentBatchLine extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @ManyToOne(() => PaymentBatch, { fieldName: 'batch_id' })
  batch!: PaymentBatch;

  @ManyToOne(() => Document)
  document!: Document;

  @Property()
  bankCode!: string;

  @Property()
  accountNo!: string;

  @Property()
  accountName!: string;

  // Document-currency amount, before withholding.
  @Property({ type: 'decimal', precision: 15, scale: 2 })
  amount!: string;

  // Chosen before export: the file must carry the amount net of withholding, which is earlier than
  // the single-document endpoint asks for it.
  @ManyToOne(() => TaxCode, { fieldName: 'wht_tax_code_id', nullable: true })
  whtTaxCode?: TaxCode;

  @Property({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  whtAmount?: string;

  // Keyed by finance at import — the bank's result file carries no rate.
  @Property({ type: 'decimal', precision: 18, scale: 8, nullable: true })
  actualRate?: string;

  @Property({ nullable: true })
  result?: string; // null = not imported / SUCCESS / FAILED / ALREADY_PAID

  @Property({ type: 'text', nullable: true })
  failReason?: string;

  /**
   * What the bank is actually asked to transfer: the payable less any withholding.
   *
   * The vendor is paid net — the withheld part is a liability we settle with the revenue
   * department, not money that leaves for the vendor — so this, not `amount`, is what belongs in
   * the file. Computed with `Money` rather than `-`: these are decimal strings, and a JS number
   * would quietly lose precision on exactly the value that moves money.
   */
  netAmount(): string {
    return Money.subtract(this.amount, this.whtAmount ?? '0');
  }
}

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

  /**
   * The company account the money left FROM — not `vendor_bank_account`, which is where it went.
   *
   * Nullable: payments recorded before bank accounts existed have none, and a guessed one would be
   * a fact about money that nobody established. A payment without it cannot be confirmed cleared,
   * because there is no account to credit.
   */
  @ManyToOne(() => BankAccount, { fieldName: 'bank_account_id', nullable: true })
  bankAccount?: BankAccount;

  // The run whose result import created this payment; null for one recorded through the
  // single-document endpoint. Makes every paid document traceable to the exact file sent to the
  // bank.
  @ManyToOne(() => PaymentBatch, { fieldName: 'batch_id', nullable: true })
  batch?: PaymentBatch;

  @ManyToOne(() => AppUser, { fieldName: 'created_by', nullable: true })
  createdBy?: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  paidAt?: Date;

  @Property({ columnType: 'timestamptz', nullable: true })
  createdAt?: Date;
}

/**
 * payment_attachment — the slips proving a payment left the bank: many per `payment`, uploaded by
 * finance, read by whoever audits it later.
 *
 * Never parsed. A slip is evidence for a human; the file the system reads is the bank's RESULT
 * file, which travels the opposite way (bank → us) and is applied to a `payment_batch`.
 *
 * Deliberately NOT `document_attachment`: a document's attachments are the requester's, editable
 * before approval, whereas the payee is fixed at submit so nobody can restate a payment
 * afterwards. Evidence of what the bank did must not sit where a requester can attach to it.
 *
 * Carries `company_id` like `payment_batch_line` (and unlike `document_attachment`, which scopes
 * through its document): the read that matters is "every slip in this company" for an audit, and
 * invariant 1 wants the company filter first. The value is copied from the payment on insert —
 * the parent stays authoritative and a payment cannot change company.
 *
 * Writes no ledger row: the budget settled to ACTUAL when the document completed, and attaching a
 * picture of a transfer settles nothing.
 */
@Entity({ tableName: 'payment_attachment' })
@Index({ properties: ['company'] })
export class PaymentAttachment extends CompanyScopedEntity {
  @ManyToOne(() => Company)
  company!: Company;

  @Index()
  @ManyToOne(() => Payment)
  payment!: Payment;

  @Property()
  fileName!: string;

  /** The storage key. Never returned to a client — downloads go out as presigned URLs. */
  @Property()
  filePath!: string;

  @Property({ type: 'int', nullable: true })
  fileSizeKb?: number;

  @Property({ nullable: true })
  mimeType?: string;

  @ManyToOne(() => AppUser, { fieldName: 'uploaded_by' })
  uploadedBy!: AppUser;

  @Property({ columnType: 'timestamptz', nullable: true })
  uploadedAt?: Date;
}
