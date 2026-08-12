import { Migration } from '@mikro-orm/migrations';

/**
 * Let the database hold the account roles the code has been using.
 *
 * `account_role.role` was last widened when the inventory and claim roles arrived. Since then
 * `ACCOUNTS_PAYABLE`, `ACCRUED_EXPENSE` and `RETAINED_EARNINGS` were added to the enum and are
 * mapped by the seed and required by the posting engine, the period close and the year close — and
 * no migration widened the constraint for them. A migration-built database refuses all three, so
 * accruing a payable, closing a period or closing a year would fail on a real deployment.
 *
 * The tests did not catch it: `refreshDatabase()` builds the schema from the ENTITIES, where the
 * enum is the only authority, so every DB-backed spec has been running against a schema the
 * migrations never produce.
 *
 * `VAT_RECEIVABLE` is added here too, which is what this change needed in the first place. The
 * constraint is rebuilt from the whole enum rather than appended to, so it cannot drift again
 * without somebody noticing this list.
 */
export class Migration20260822000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "account_role" drop constraint if exists "account_role_role_check";`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_role_check" check (` +
        `"role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS', 'VAT_INPUT', 'VAT_RECEIVABLE', ` +
        `'WHT_PAYABLE', 'INVENTORY', 'GRNI', 'INVENTORY_ADJUSTMENT', 'INVENTORY_IN_TRANSIT', ` +
        `'CLAIM_PAYABLE', 'ACCOUNTS_PAYABLE', 'ACCRUED_EXPENSE', 'RETAINED_EARNINGS'));`,
    );
  }

  /**
   * Narrowing back refuses if any row uses a role it would forbid, rather than dropping the
   * constraint and leaving rows the schema rejects.
   */
  override async down(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if exists (
          select 1 from "account_role"
          where "role" in ('VAT_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'ACCRUED_EXPENSE', 'RETAINED_EARNINGS')
        ) then
          raise exception 'Cannot narrow account_role.role: rows use roles this would forbid. Remap them first.';
        end if;
      end $$;
    `);
    this.addSql(`alter table "account_role" drop constraint if exists "account_role_role_check";`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_role_check" check (` +
        `"role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS', 'VAT_INPUT', 'WHT_PAYABLE', ` +
        `'INVENTORY', 'GRNI', 'INVENTORY_ADJUSTMENT', 'INVENTORY_IN_TRANSIT', 'CLAIM_PAYABLE'));`,
    );
  }
}
