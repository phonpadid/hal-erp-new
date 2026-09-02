import { Migration } from '@mikro-orm/migrations';

/**
 * Let a payment run say which account it drew on.
 *
 * A batch is one file sent to one bank from one account, and it recorded everything about the run
 * except that — so every payment a batch created carried no bank account and landed in the
 * unattributed reconciliation read. Visible, but unreconcilable until somebody attributed it by
 * hand, on the normal path rather than an exceptional one.
 *
 * Nullable, and nothing is derived. A batch that predates this column cannot say which account it
 * drew on; choosing the company's only bank account would be a guess written as a fact about money.
 * Those payments stay unattributed, which is what that read is for.
 */
export class Migration20260821000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "payment_batch" add column "bank_account_id" uuid null;`);
    this.addSql(
      `alter table "payment_batch" add constraint "payment_batch_bank_account_id_foreign" ` +
        `foreign key ("bank_account_id") references "bank_account" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "payment_batch" drop constraint if exists "payment_batch_bank_account_id_foreign";`);
    this.addSql(`alter table "payment_batch" drop column "bank_account_id";`);
  }
}
