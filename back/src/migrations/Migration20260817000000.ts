import { Migration } from '@mikro-orm/migrations';

/**
 * Give a purchase the date and number of the invoice it is claiming against.
 *
 * The tax point for input VAT is the supplier's tax invoice, and the system had neither its date
 * nor its number: the accrual posted on `approved_at` — when somebody clicked approve — and
 * `doc_no` is this company's own running number, not the supplier's. A VAT return was therefore
 * filed on dates the system generated for itself, and the purchase listing that supports one could
 * not be produced at all.
 *
 * Both nullable: most document types are not purchases, and a leave request has no supplier
 * invoice. Submit requires them only when the document actually claims VAT.
 *
 * No data change. Documents submitted before this have no invoice date, and are not given one
 * derived from their approval — that would be a guess recorded as a tax fact.
 */
export class Migration20260817000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document" add column "vendor_invoice_no" varchar(255) null;`);
    this.addSql(`alter table "document" add column "vendor_invoice_date" date null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document" drop column "vendor_invoice_no";`);
    this.addSql(`alter table "document" drop column "vendor_invoice_date";`);
  }
}
