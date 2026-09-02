import { Migration } from '@mikro-orm/migrations';

/**
 * The evidence a payee is owed, and the money the revenue authority is owed.
 *
 * `WHT_PAYABLE` was credited at every withholding payment and debited nowhere, so the balance sheet
 * reported a liability the company had in fact been discharging every month — and the payee, from
 * whom the tax was withheld, had no certificate with which to claim the deduction.
 *
 * No data is written. Payments that withheld before this have no certificate and are not given a
 * backdated one: a certificate carries an issue date and a number the payee was handed, and
 * generating them now would produce documents dated today, in this year's sequence, for deductions
 * made months ago, which no payee has ever seen. Their withholding stays visible as an outstanding
 * `WHT_PAYABLE` balance, and clearing it is a manual journal voucher — the honest tool for an
 * obligation discharged outside the process.
 */
export class Migration20260818000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "wht_certificate_number" (
        "id" uuid not null,
        "company_id" uuid not null,
        "year" int not null,
        "current_no" int not null default 0,
        constraint "wht_certificate_number_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "wht_certificate_number" add constraint "wht_certificate_number_company_id_year_unique" unique ("company_id", "year");`,
    );
    this.addSql(
      `alter table "wht_certificate_number" add constraint "wht_certificate_number_company_id_foreign" ` +
        `foreign key ("company_id") references "company" ("id") on update cascade;`,
    );

    this.addSql(`
      create table "wht_certificate" (
        "id" uuid not null,
        "company_id" uuid not null,
        "payment_id" uuid not null,
        "certificate_no" varchar(255) not null,
        "vendor_id" uuid null,
        "tax_code_id" uuid null,
        "rate" numeric(9,6) not null,
        "base_amount" numeric(15,2) not null,
        "wht_amount" numeric(15,2) not null,
        "issued_on" date not null,
        "issued_by" uuid null,
        "remittance_id" uuid null,
        "remitted_on" date null,
        "created_at" timestamptz null,
        constraint "wht_certificate_pkey" primary key ("id")
      );
    `);
    // A payment withholds once, so it is certified once — a property of the schema rather than of a
    // check somebody has to remember.
    this.addSql(
      `alter table "wht_certificate" add constraint "wht_certificate_payment_id_unique" unique ("payment_id");`,
    );
    this.addSql(
      `alter table "wht_certificate" add constraint "wht_certificate_company_id_certificate_no_unique" unique ("company_id", "certificate_no");`,
    );
    this.addSql(
      `create index "wht_certificate_company_id_remittance_id_index" on "wht_certificate" ("company_id", "remittance_id");`,
    );
    for (const [col, table] of [
      ['company_id', 'company'],
      ['payment_id', 'payment'],
      ['vendor_id', 'vendor'],
      ['tax_code_id', 'tax_code'],
      ['issued_by', 'app_user'],
    ] as const) {
      this.addSql(
        `alter table "wht_certificate" add constraint "wht_certificate_${col}_foreign" ` +
          `foreign key ("${col}") references "${table}" ("id") on update cascade` +
          `${col === 'company_id' || col === 'payment_id' ? '' : ' on delete set null'};`,
      );
    }
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "wht_certificate";`);
    this.addSql(`drop table if exists "wht_certificate_number";`);
  }
}
