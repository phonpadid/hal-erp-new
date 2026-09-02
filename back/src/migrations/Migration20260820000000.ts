import { Migration } from '@mikro-orm/migrations';

/**
 * Give the company's cash something to be reconciled against.
 *
 * `CASH_CLEARING` was named for a clearing account and mapped straight to `1000 Cash`, so a payment
 * credited Cash the moment finance recorded it, whether or not the money had left the bank. Nothing
 * recorded WHICH bank account paid — `vendor_bank_account` is the payee's — so a company with two
 * accounts had one indistinguishable Cash balance, and there was no state between "recorded" and
 * "gone" to reconcile.
 *
 * `payment.bank_account_id` is nullable and stays null for every payment recorded before this. A
 * guessed bank account would be a fact about money that nobody established.
 *
 * NOTHING is re-mapped. An existing company keeps `CASH_CLEARING → 1000 Cash` and behaves exactly
 * as before: re-pointing a live role in a migration would move every historical payment's credit to
 * an account those payments never touched, silently, for balances somebody has already reported on.
 * Adopting the two-step shape is three deliberate acts — create the clearing account, move the
 * balance with a journal voucher, re-point the role — each visible.
 */
export class Migration20260820000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "bank_account" (
        "id" uuid not null,
        "company_id" uuid not null,
        "name" varchar(255) not null,
        "bank_name" varchar(255) not null,
        "account_no" varchar(255) not null,
        "currency_code" varchar(3) not null,
        "gl_account_id" uuid not null,
        "is_active" boolean not null default true,
        "created_at" timestamptz null,
        constraint "bank_account_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "bank_account" add constraint "bank_account_company_id_account_no_unique" unique ("company_id", "account_no");`,
    );
    this.addSql(
      `alter table "bank_account" add constraint "bank_account_company_id_foreign" ` +
        `foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "bank_account" add constraint "bank_account_currency_code_foreign" ` +
        `foreign key ("currency_code") references "currency" ("code") on update cascade;`,
    );
    this.addSql(
      `alter table "bank_account" add constraint "bank_account_gl_account_id_foreign" ` +
        `foreign key ("gl_account_id") references "account" ("id") on update cascade;`,
    );

    this.addSql(`alter table "payment" add column "bank_account_id" uuid null;`);
    this.addSql(
      `alter table "payment" add constraint "payment_bank_account_id_foreign" ` +
        `foreign key ("bank_account_id") references "bank_account" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "payment" drop constraint if exists "payment_bank_account_id_foreign";`);
    this.addSql(`alter table "payment" drop column "bank_account_id";`);
    this.addSql(`drop table if exists "bank_account";`);
  }
}
