import { Migration } from '@mikro-orm/migrations';

/**
 * Mark non-human identities on `app_user`.
 *
 * A service account is an integration identity — HAL's `claim-bot` is the one in production —
 * that holds real permission codes and authenticates only by API key. Until now nothing recorded
 * that an account was one: the only signal was a null `password_hash`, which a person can also
 * have. Inferring identity kind from that would make the admin badge lie and, worse, would key
 * the interactive-login denial to a state a human can transiently enter.
 *
 * The column is additive with a `false` default, which is the correct value for every row that
 * exists today — every current account is a person's. Existing passwordless accounts are NOT
 * flagged here: doing so would be exactly the guess-from-the-missing-hash this column exists to
 * replace. Flagging `claim-bot` is a deliberate one-row update per environment.
 */
export class Migration20260808000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "app_user" add column "is_service_account" boolean not null default false;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "app_user" drop column "is_service_account";`);
  }
}
