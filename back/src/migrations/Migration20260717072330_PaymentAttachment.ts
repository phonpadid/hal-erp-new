import { Migration } from '@mikro-orm/migrations';

/**
 * payment_attachment — the slips proving a payment left the bank. Many per `payment`; metadata
 * here, bytes in S3/MinIO under `file_path`, exactly like `document_attachment`.
 *
 * Carries `company_id` (like `payment_batch_line`, unlike `document_attachment`) because the read
 * that matters is "every slip in this company" for an audit, and invariant 1 asks for the company
 * filter first. Inserts copy it from the payment, so the parent stays authoritative.
 *
 * Purely additive: nothing reads the table on the pay path, no backfill, and `payment` is
 * untouched — a payment with no slips behaves exactly as it does today. Writes no ledger row; the
 * budget settled to ACTUAL when the document completed.
 *
 * NOTE: the generator also wanted to drop `app_user_current_signature_id_foreign`, retype
 * `pending_successor.status`, and make `payment_batch_line.wht_amount` NOT NULL. That is
 * pre-existing entity/DB drift with nothing to do with slips, so it is deliberately left out — a
 * migration should do what its name says.
 */
export class Migration20260717072330_PaymentAttachment extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "payment_attachment" ("id" uuid not null, "company_id" uuid not null, "payment_id" uuid not null, "file_name" varchar(255) not null, "file_path" varchar(255) not null, "file_size_kb" int null, "mime_type" varchar(255) null, "uploaded_by" uuid not null, "uploaded_at" timestamptz null, constraint "payment_attachment_pkey" primary key ("id"));`,
    );
    this.addSql(`create index "payment_attachment_payment_id_index" on "payment_attachment" ("payment_id");`);
    this.addSql(`create index "payment_attachment_company_id_index" on "payment_attachment" ("company_id");`);

    this.addSql(
      `alter table "payment_attachment" add constraint "payment_attachment_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "payment_attachment" add constraint "payment_attachment_payment_id_foreign" foreign key ("payment_id") references "payment" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "payment_attachment" add constraint "payment_attachment_uploaded_by_foreign" foreign key ("uploaded_by") references "app_user" ("id") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_attachment" cascade;`);
  }
}
