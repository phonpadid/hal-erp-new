import { Migration } from '@mikro-orm/migrations';

/**
 * One record of money leaving, whoever is paid.
 *
 * `document_settlement` was a second way to pay, for documents owed to a person rather than a
 * vendor. It duplicated a path that was already generic: `postForPayment` clears whatever account
 * the accrual credited, so it cleared `CLAIM_PAYABLE` without being told to — the settlement
 * posting was that same function with the account hard-coded and withholding removed.
 *
 * What the dropped table carried and `payment` did not is added here, and all three were missing
 * from vendor payments too:
 *
 *   · `method`    — how the money moved. Decides whether evidence is required, and explains a bank
 *                   credit that never had a file behind it.
 *   · `reference` — the bank's transfer number. A hand-recorded vendor payment has one and had
 *                   nowhere to put it.
 *   · `note`      — what the person recording it needed to say.
 *
 * The table is DROPPED rather than left empty. Nothing has launched, no row exists anywhere, no
 * company has mapped `CLAIM_PAYABLE`, and no seeded document type could produce a settlement —
 * keeping it would preserve compatibility with nobody while leaving two ways to pay a person in a
 * codebase whose argument is that there should be one.
 */
export class Migration20260825000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "payment" add column "method" varchar(255) not null default 'TRANSFER';`);
    this.addSql(`alter table "payment" add column "reference" varchar(255) null;`);
    this.addSql(`alter table "payment" add column "note" text null;`);

    // Refuse to drop data rather than destroy it. There is none — this is the assertion that says
    // so out loud, and a deployment that finds some stops instead of discarding somebody's record
    // of money that left.
    this.addSql(`do $$
      declare leftover int;
      begin
        if to_regclass('public.document_settlement') is null then
          return;
        end if;
        select count(*) into leftover from "document_settlement";
        if leftover > 0 then
          raise exception
            'document_settlement holds % row(s). This migration converges settlement into payment '
            'and has no rule for moving them: each would need a payment with an actual rate, a '
            'method and a bank account nobody recorded. Migrate them deliberately, then re-run.',
            leftover;
        end if;
      end $$;`);
    this.addSql(`drop table if exists "document_settlement" cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "document_settlement" (
      "id" uuid not null default gen_random_uuid(),
      "company_id" uuid not null,
      "document_id" uuid not null,
      "settlement_type" varchar(255) not null,
      "settled_at" date not null,
      "reference" varchar(255) null,
      "settled_by" uuid not null,
      "note" text null,
      "created_at" timestamptz null,
      constraint "document_settlement_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "document_settlement" add constraint "document_settlement_document_id_unique" unique ("document_id");`,
    );
    this.addSql(
      `create index "document_settlement_company_id_settled_at_index" on "document_settlement" ("company_id", "settled_at");`,
    );
    this.addSql(
      `alter table "document_settlement" add constraint "document_settlement_company_id_foreign" ` +
        `foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "document_settlement" add constraint "document_settlement_document_id_foreign" ` +
        `foreign key ("document_id") references "document" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "document_settlement" add constraint "document_settlement_settled_by_foreign" ` +
        `foreign key ("settled_by") references "app_user" ("id") on update cascade;`,
    );

    this.addSql(`alter table "payment" drop column "note";`);
    this.addSql(`alter table "payment" drop column "reference";`);
    this.addSql(`alter table "payment" drop column "method";`);
  }
}
