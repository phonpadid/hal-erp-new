import { Migration } from '@mikro-orm/migrations';

/**
 * payment — one record per settled disbursement capturing the locked vs actual FX rate and the
 * resulting gain/loss. The FX delta goes to accounting (the `payment.settled` event), never to
 * `budget_txn`. Unique on document_id (one payment per disbursement).
 */
export class Migration20260629000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "payment" (
        "id" uuid not null,
        "company_id" uuid not null,
        "document_id" uuid not null,
        "locked_rate" numeric(18,8) not null,
        "actual_rate" numeric(18,8) not null,
        "base_locked" numeric(15,2) not null,
        "base_actual" numeric(15,2) not null,
        "fx_delta" numeric(15,2) not null,
        "fx_kind" varchar(255) not null,
        "created_by" uuid null,
        "paid_at" timestamptz null,
        "created_at" timestamptz null,
        constraint "payment_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "payment" add constraint "payment_document_id_unique" unique ("document_id");`);
    this.addSql(`alter table "payment" add constraint "payment_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`);
    this.addSql(`alter table "payment" add constraint "payment_document_id_foreign" foreign key ("document_id") references "document" ("id") on update cascade;`);
    this.addSql(`alter table "payment" add constraint "payment_created_by_foreign" foreign key ("created_by") references "app_user" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment" cascade;`);
  }
}
