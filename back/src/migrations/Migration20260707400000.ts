import { Migration } from '@mikro-orm/migrations';

/**
 * Fix: the `account_role.role` check constraint was created in the GL slice with only the three
 * original roles (CASH_CLEARING / FX_GAIN / FX_LOSS). The VAT slice added VAT_INPUT and the WHT
 * slice added WHT_PAYABLE to the enum, but neither altered the DB constraint — so seeding those
 * roles fails with a check-constraint violation. Widen the constraint to all five roles.
 */
export class Migration20260707400000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "account_role" drop constraint if exists "account_role_role_check";`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_role_check" check ("role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS', 'VAT_INPUT', 'WHT_PAYABLE'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "account_role" drop constraint if exists "account_role_role_check";`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_role_check" check ("role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS'));`,
    );
  }
}
