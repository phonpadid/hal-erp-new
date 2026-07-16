import { Migration } from '@mikro-orm/migrations';

/**
 * Payment batches: give a vendor bank accounts, bind a payee to the disbursement, and add the
 * run that exports a file for the bank and imports its result.
 *
 * - `vendor_bank_account` — a vendor's payee accounts (several per vendor). Hangs off the
 *   group-level `vendor`, so accounts are shared across the group like the vendor's own name; a
 *   GROUP-scope read under invariant 1, never a cross-company write. `account_no` is text, always:
 *   it identifies, it does not measure, and as a number its leading zeros would vanish.
 * - `vendor_bank_account_log` — who changed a payee account and from what to what. The account
 *   table is not append-only, so without this an edit-pay-revert leaves no trace at all.
 * - `document_type.requires_payee` — whether a type must name a payee before submit. Its own flag,
 *   NOT a reading of `post_action`: the seeded PR carries CUT_BUDGET too, and a requisition has no
 *   payee yet, so inferring would block every PR submit.
 * - `document.vendor_bank_account_id` — the approved destination, so it travels the same approval
 *   steps as the amount.
 * - `payment_batch` / `payment_batch_line` — the run. Lines snapshot the payee rather than joining
 *   live, so a later account edit cannot rewrite what an exported batch says.
 * - `payment.batch_id` — which run produced a payment; null for the single-document endpoint.
 *
 * Writes no ledger row and no backfill: existing documents have no payee and are already paid or
 * still queued, and `requires_payee` defaults false so the submit gate is inert until a type opts
 * in. Every added column is nullable or defaulted, so `down` reverses cleanly.
 */
export class Migration20260725000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "vendor_bank_account" (
      "id" uuid not null,
      "vendor_id" uuid not null,
      "bank_code" varchar(255) not null,
      "account_no" varchar(255) not null,
      "account_name" varchar(255) not null,
      "currency" varchar(3) null,
      "is_primary" boolean not null default false,
      "is_active" boolean not null default true,
      "created_at" timestamptz(6) null,
      "updated_at" timestamptz(6) null,
      constraint "vendor_bank_account_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "vendor_bank_account" add constraint "vendor_bank_account_vendor_id_bank_code_account_no_unique" unique ("vendor_id", "bank_code", "account_no");`,
    );
    this.addSql(`create index "vendor_bank_account_vendor_id_index" on "vendor_bank_account" ("vendor_id");`);
    this.addSql(
      `alter table "vendor_bank_account" add constraint "vendor_bank_account_vendor_id_foreign" foreign key ("vendor_id") references "vendor" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "vendor_bank_account" add constraint "vendor_bank_account_currency_foreign" foreign key ("currency") references "currency" ("code") on update cascade on delete set null;`,
    );

    this.addSql(`create table "vendor_bank_account_log" (
      "id" uuid not null,
      "vendor_bank_account_id" uuid not null,
      "actor_id" uuid not null,
      "action" varchar(255) not null,
      "before_json" text null,
      "after_json" text null,
      "acted_at" timestamptz(6) null,
      constraint "vendor_bank_account_log_pkey" primary key ("id")
    );`);
    this.addSql(
      `create index "vendor_bank_account_log_vendor_bank_account_id_index" on "vendor_bank_account_log" ("vendor_bank_account_id");`,
    );
    this.addSql(
      `alter table "vendor_bank_account_log" add constraint "vendor_bank_account_log_vendor_bank_account_id_foreign" foreign key ("vendor_bank_account_id") references "vendor_bank_account" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "vendor_bank_account_log" add constraint "vendor_bank_account_log_actor_id_foreign" foreign key ("actor_id") references "app_user" ("id") on update cascade;`,
    );

    this.addSql(`create table "payment_batch" (
      "id" uuid not null,
      "company_id" uuid not null,
      "status" varchar(255) not null default 'DRAFT',
      "format" varchar(255) not null default 'CSV',
      "pay_date" date null,
      "file_path" varchar(255) null,
      "exported_at" timestamptz(6) null,
      "imported_at" timestamptz(6) null,
      "created_by" uuid null,
      "created_at" timestamptz(6) null,
      "updated_at" timestamptz(6) null,
      constraint "payment_batch_pkey" primary key ("id")
    );`);
    this.addSql(`create index "payment_batch_company_id_status_index" on "payment_batch" ("company_id", "status");`);
    this.addSql(
      `alter table "payment_batch" add constraint "payment_batch_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "payment_batch" add constraint "payment_batch_created_by_foreign" foreign key ("created_by") references "app_user" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`create table "payment_batch_line" (
      "id" uuid not null,
      "company_id" uuid not null,
      "batch_id" uuid not null,
      "document_id" uuid not null,
      "bank_code" varchar(255) not null,
      "account_no" varchar(255) not null,
      "account_name" varchar(255) not null,
      "amount" numeric(15,2) not null,
      "wht_tax_code_id" uuid null,
      "wht_amount" numeric(15,2) null default 0,
      "actual_rate" numeric(18,8) null,
      "result" varchar(255) null,
      "fail_reason" text null,
      constraint "payment_batch_line_pkey" primary key ("id")
    );`);
    this.addSql(`create index "payment_batch_line_batch_id_index" on "payment_batch_line" ("batch_id");`);
    // One line per document per batch: a payable must not be listed twice in one file.
    this.addSql(
      `alter table "payment_batch_line" add constraint "payment_batch_line_batch_id_document_id_unique" unique ("batch_id", "document_id");`,
    );
    this.addSql(
      `alter table "payment_batch_line" add constraint "payment_batch_line_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "payment_batch_line" add constraint "payment_batch_line_batch_id_foreign" foreign key ("batch_id") references "payment_batch" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "payment_batch_line" add constraint "payment_batch_line_document_id_foreign" foreign key ("document_id") references "document" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "payment_batch_line" add constraint "payment_batch_line_wht_tax_code_id_foreign" foreign key ("wht_tax_code_id") references "tax_code" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`alter table "document_type" add column "requires_payee" boolean not null default false;`);

    this.addSql(`alter table "document" add column "vendor_bank_account_id" uuid null;`);
    this.addSql(
      `alter table "document" add constraint "document_vendor_bank_account_id_foreign" foreign key ("vendor_bank_account_id") references "vendor_bank_account" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`alter table "payment" add column "batch_id" uuid null;`);
    this.addSql(
      `alter table "payment" add constraint "payment_batch_id_foreign" foreign key ("batch_id") references "payment_batch" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "payment" drop constraint if exists "payment_batch_id_foreign";`);
    this.addSql(`alter table "payment" drop column if exists "batch_id";`);
    this.addSql(`alter table "document" drop constraint if exists "document_vendor_bank_account_id_foreign";`);
    this.addSql(`alter table "document" drop column if exists "vendor_bank_account_id";`);
    this.addSql(`alter table "document_type" drop column if exists "requires_payee";`);
    this.addSql(`drop table if exists "payment_batch_line" cascade;`);
    this.addSql(`drop table if exists "payment_batch" cascade;`);
    this.addSql(`drop table if exists "vendor_bank_account_log" cascade;`);
    this.addSql(`drop table if exists "vendor_bank_account" cascade;`);
  }
}
