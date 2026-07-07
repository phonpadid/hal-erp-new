import { Migration } from '@mikro-orm/migrations';

/**
 * Double-entry general ledger (first GL slice). Adds `account_role` (system-account role map
 * per company), and the append-only `journal_entry` / `journal_line` tables. Entries are
 * balanced (Σdebit = Σcredit) and idempotent per source. No change to `budget_txn` or
 * `payment` — the GL posts off the existing `payment.settled` event (invariant 6).
 */
export class Migration20260707100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "account_role" (
      "id" uuid not null,
      "company_id" uuid not null,
      "role" text check ("role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS')) not null,
      "account_id" uuid not null,
      constraint "account_role_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_company_id_role_unique" unique ("company_id", "role");`,
    );
    this.addSql(
      `alter table "account_role" add constraint "account_role_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "account_role" add constraint "account_role_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade;`,
    );

    this.addSql(`create table "journal_entry" (
      "id" uuid not null,
      "company_id" uuid not null,
      "entry_date" date not null,
      "source_type" varchar(255) not null,
      "source_id" uuid not null,
      "memo" varchar(255) null,
      "created_by" uuid null,
      "created_at" timestamptz null,
      constraint "journal_entry_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "journal_entry" add constraint "journal_entry_company_id_source_type_source_id_unique" unique ("company_id", "source_type", "source_id");`,
    );
    this.addSql(
      `alter table "journal_entry" add constraint "journal_entry_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "journal_entry" add constraint "journal_entry_created_by_foreign" foreign key ("created_by") references "app_user" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`create table "journal_line" (
      "id" uuid not null,
      "company_id" uuid not null,
      "journal_entry_id" uuid not null,
      "account_id" uuid not null,
      "debit" numeric(15,2) not null default 0,
      "credit" numeric(15,2) not null default 0,
      "memo" varchar(255) null,
      constraint "journal_line_pkey" primary key ("id")
    );`);
    this.addSql(`create index "journal_line_journal_entry_id_index" on "journal_line" ("journal_entry_id");`);
    this.addSql(`create index "journal_line_account_id_index" on "journal_line" ("account_id");`);
    this.addSql(
      `alter table "journal_line" add constraint "journal_line_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "journal_line" add constraint "journal_line_journal_entry_id_foreign" foreign key ("journal_entry_id") references "journal_entry" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "journal_line" add constraint "journal_line_account_id_foreign" foreign key ("account_id") references "account" ("id") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "journal_line" cascade;`);
    this.addSql(`drop table if exists "journal_entry" cascade;`);
    this.addSql(`drop table if exists "account_role" cascade;`);
  }
}
