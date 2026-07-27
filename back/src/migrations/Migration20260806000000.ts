import { Migration } from '@mikro-orm/migrations';

/**
 * Somewhere to record that the money left.
 *
 * A claim that accrues at approval leaves `Cr CLAIM_PAYABLE` behind, and nothing clears it:
 * finance transfers through the bank's own app, so there is no payment batch and no
 * `payment.settled` to post the other half. The payable would grow by every claim ever approved.
 *
 * The state has nowhere else to live. `document.status` cannot carry it — `COMPLETED` already
 * means "fully approved", set by the router after the post-action in the same transaction. A
 * `payment` row cannot carry it either: writing one fires `payment.settled`, and `postForPayment`
 * would debit the same expense accounts a second time.
 *
 * `document_id` is unique because money does not leave twice. `company_id` is carried on the row
 * for the same reason `payment_attachment` carries it: the query finance actually runs is "what is
 * still unsettled in this company", and invariant 1 filters by company first.
 *
 * Purely additive: one new table, no existing column or row touched.
 */
export class Migration20260806000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "document_settlement" (
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
      );
    `);
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
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "document_settlement" cascade;`);
  }
}
