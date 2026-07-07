import { Migration } from '@mikro-orm/migrations';

/**
 * Email verification for accounts. Adds `app_user.email_verified_at` (null = unverified; login is
 * blocked while null) and `email_verification_token`, holding only the HASH of a single-use,
 * time-limited token (the raw token lives only in the emailed link). No company_id: app_user is
 * global, so this stays clear of company isolation (invariant 1). Additive only.
 */
export class Migration20260703100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "app_user" add column "email_verified_at" timestamptz null;`);

    this.addSql(`create table "email_verification_token" (
      "id" uuid not null,
      "user_id" uuid not null,
      "token_hash" varchar(255) not null,
      "expires_at" timestamptz not null,
      "consumed_at" timestamptz null,
      "created_at" timestamptz null,
      constraint "email_verification_token_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "email_verification_token" add constraint "email_verification_token_token_hash_unique" unique ("token_hash");`,
    );
    this.addSql(
      `create index "email_verification_token_user_id_consumed_at_index" on "email_verification_token" ("user_id", "consumed_at");`,
    );
    this.addSql(
      `alter table "email_verification_token" add constraint "email_verification_token_user_id_foreign" foreign key ("user_id") references "app_user" ("id") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "email_verification_token" cascade;`);
    this.addSql(`alter table "app_user" drop column "email_verified_at";`);
  }
}
