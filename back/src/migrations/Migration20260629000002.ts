import { Migration } from '@mikro-orm/migrations';

/**
 * Budget basis at the BUDGET_RATE. Budget reservation/settlement and approval thresholds use a
 * budget base converted at the fixed BUDGET_RATE (daily fallback), while the document keeps
 * recording the daily rate for display + payment FX. Nullable: older documents fall back to the
 * daily base.
 */
export class Migration20260629000002 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document" add column "budget_exchange_rate" numeric(18,8) null;`);
    this.addSql(`alter table "document" add column "budget_base_total_amount" numeric(15,2) null;`);
    this.addSql(`alter table "document_line" add column "budget_base_line_amount" numeric(15,2) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_line" drop column "budget_base_line_amount";`);
    this.addSql(`alter table "document" drop column "budget_base_total_amount";`);
    this.addSql(`alter table "document" drop column "budget_exchange_rate";`);
  }
}
