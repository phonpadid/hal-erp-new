import { Migration } from '@mikro-orm/migrations';

/**
 * Config-driven vendor requirement. A document_type may now declare that its documents must
 * carry a vendor (procurement types like PR/PO), gating the vendor picker in the UI and
 * enforcing presence at submit — alongside the existing requires_budget / requires_quota
 * flags (invariant 7: behavior comes from configuration, not per-type code). Defaults false,
 * so existing types keep their current (vendor-optional) behavior.
 */
export class Migration20260630000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "document_type" add column "requires_vendor" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_type" drop column "requires_vendor";`);
  }
}
