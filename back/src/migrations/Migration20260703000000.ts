import { Migration } from '@mikro-orm/migrations';

/**
 * Self-service password reset. Adds `password_reset_token`, holding only the HASH of a
 * single-use, time-limited reset token (the raw token lives only in the emailed link).
 * No company_id: app_user is global, so this stays clear of company isolation (invariant 1).
 * Additive only — existing auth is untouched.
 */
export class Migration20260703000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "password_reset_token" (
      "id" uuid not null,
      "user_id" uuid not null,
      "token_hash" varchar(255) not null,
      "expires_at" timestamptz not null,
      "consumed_at" timestamptz null,
      "created_at" timestamptz null,
      constraint "password_reset_token_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "password_reset_token" add constraint "password_reset_token_token_hash_unique" unique ("token_hash");`,
    );
    this.addSql(
      `create index "password_reset_token_user_id_consumed_at_index" on "password_reset_token" ("user_id", "consumed_at");`,
    );
    this.addSql(
      `alter table "password_reset_token" add constraint "password_reset_token_user_id_foreign" foreign key ("user_id") references "app_user" ("id") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "password_reset_token" cascade;`);
  }
}
