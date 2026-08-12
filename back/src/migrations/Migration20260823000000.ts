import { Migration } from '@mikro-orm/migrations';

/**
 * Record the VAT returns a company has filed.
 *
 * Filing moves the period's input VAT from "tax paid on purchases" to "a debt the revenue authority
 * owes" — different assets, and the move between them IS the filing. Without a row saying which
 * period was claimed, a second return for the same month would credit `VAT_INPUT` twice for one
 * claim and nothing would refuse it.
 *
 * The unique key is the PERIOD, not the entry: idempotency on `(company, VAT_RETURN, source_id)`
 * stops the same filing being posted twice, and this stops two different filings claiming the same
 * month.
 */
export class Migration20260823000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "vat_return" (
      "id" uuid not null,
      "company_id" uuid not null,
      "period_from" date not null,
      "period_to" date not null,
      "input_vat" numeric(15,2) not null,
      "filed_on" date not null,
      "filed_by" uuid null,
      "created_at" timestamptz null,
      constraint "vat_return_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "vat_return" add constraint "vat_return_company_id_foreign" ` +
        `foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "vat_return" add constraint "vat_return_filed_by_foreign" ` +
        `foreign key ("filed_by") references "app_user" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "vat_return" add constraint "vat_return_company_id_period_from_period_to_unique" ` +
        `unique ("company_id", "period_from", "period_to");`,
    );
    this.addSql(`create index "vat_return_company_id_filed_on_index" on "vat_return" ("company_id", "filed_on");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "vat_return" cascade;`);
  }
}
