import { Migration } from '@mikro-orm/migrations';

/**
 * Give the manual journal entry a second pair of eyes.
 *
 * `GL_JV_POST` documented its own gap: the largest privilege in the system, guarded by a permission
 * rather than by an approval route, with the instruction to grant it to very few people "until that
 * route exists". One person could debit and credit any account in any amount with nobody else
 * involved, while a five-thousand-kip requisition passed through a configured approval chain.
 *
 * The header exists because an approval step needs somewhere to hold an entry that is not yet an
 * entry. `journal_entry` is append-only and cannot carry a pending state; posting first and
 * reversing on rejection would leave unapproved entries in the ledger permanently, which is what
 * the control prevents. `gl_posting_attempt` is not the place either — the period close reads it to
 * decide whether a month is drained, so a voucher waiting on a person would make a close wait on
 * human work it cannot resolve.
 *
 * No data change. Entries posted before this were posted under the old direct-post rule and stand.
 */
export class Migration20260819000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "journal_voucher" (
        "id" uuid not null,
        "company_id" uuid not null,
        "entry_date" date not null,
        "memo" varchar(255) not null,
        "status" text check ("status" in ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')) not null default 'PENDING',
        "reverses_entry_id" uuid null,
        "created_by" uuid not null,
        "decided_by" uuid null,
        "decided_at" timestamptz null,
        "reject_reason" text null,
        "created_at" timestamptz null,
        constraint "journal_voucher_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "journal_voucher_company_id_status_index" on "journal_voucher" ("company_id", "status");`);
    this.addSql(
      `alter table "journal_voucher" add constraint "journal_voucher_company_id_foreign" ` +
        `foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "journal_voucher" add constraint "journal_voucher_created_by_foreign" ` +
        `foreign key ("created_by") references "app_user" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "journal_voucher" add constraint "journal_voucher_decided_by_foreign" ` +
        `foreign key ("decided_by") references "app_user" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`
      create table "journal_voucher_line" (
        "id" uuid not null,
        "company_id" uuid not null,
        "voucher_id" uuid not null,
        "account_id" uuid not null,
        "debit" numeric(15,2) not null default 0,
        "credit" numeric(15,2) not null default 0,
        "memo" varchar(255) null,
        constraint "journal_voucher_line_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "journal_voucher_line_voucher_id_index" on "journal_voucher_line" ("voucher_id");`);
    this.addSql(
      `alter table "journal_voucher_line" add constraint "journal_voucher_line_company_id_foreign" ` +
        `foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "journal_voucher_line" add constraint "journal_voucher_line_voucher_id_foreign" ` +
        `foreign key ("voucher_id") references "journal_voucher" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "journal_voucher_line" add constraint "journal_voucher_line_account_id_foreign" ` +
        `foreign key ("account_id") references "account" ("id") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "journal_voucher_line";`);
    this.addSql(`drop table if exists "journal_voucher";`);
  }
}
