import { Migration } from '@mikro-orm/migrations';

/**
 * Withholding tax at payment (completes purchase-tax). Adds `payment.wht_amount` (deducted from the
 * vendor's cash on the pre-VAT net base) and `payment.wht_tax_code_id`. Additive; payments without a
 * WHT code keep `wht_amount` 0. No change to `budget_txn` — WHT is an accounting deduction only.
 */
export class Migration20260707300000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "payment" add column "wht_amount" numeric(15,2) not null default 0;`);
    this.addSql(`alter table "payment" add column "wht_tax_code_id" uuid null;`);
    this.addSql(
      `alter table "payment" add constraint "payment_wht_tax_code_id_foreign" foreign key ("wht_tax_code_id") references "tax_code" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "payment" drop constraint if exists "payment_wht_tax_code_id_foreign";`);
    this.addSql(`alter table "payment" drop column "wht_tax_code_id";`);
    this.addSql(`alter table "payment" drop column "wht_amount";`);
  }
}
