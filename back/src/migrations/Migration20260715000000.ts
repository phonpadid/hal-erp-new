import { Migration } from '@mikro-orm/migrations';

/**
 * Create `api_key` — long-lived machine credential for external (M2M) access.
 * Company-scoped (invariant 1): bound to one company + one app_user. Only the secret HASH
 * is stored (custody mirrors password_reset_token / email_verification_token). Indexed by
 * public `prefix` for the auth lookup; `(company_id, revoked_at)` for admin listings.
 */
export class Migration20260715000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "api_key" (
      "id" uuid not null,
      "company_id" uuid not null,
      "user_id" uuid not null,
      "name" varchar(255) not null,
      "prefix" varchar(255) not null,
      "secret_hash" varchar(255) not null,
      "created_by" uuid not null,
      "expires_at" timestamptz null,
      "revoked_at" timestamptz null,
      "last_used_at" timestamptz null,
      "created_at" timestamptz null,
      constraint "api_key_pkey" primary key ("id")
    );`);

    this.addSql(`alter table "api_key" add constraint "api_key_prefix_unique" unique ("prefix");`);
    this.addSql(`create index "api_key_prefix_index" on "api_key" ("prefix");`);
    this.addSql(`create index "api_key_company_id_revoked_at_index" on "api_key" ("company_id", "revoked_at");`);
    this.addSql(`create index "api_key_user_id_index" on "api_key" ("user_id");`);

    this.addSql(
      `alter table "api_key" add constraint "api_key_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "api_key" add constraint "api_key_user_id_foreign" foreign key ("user_id") references "app_user" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "api_key" add constraint "api_key_created_by_foreign" foreign key ("created_by") references "app_user" ("id") on update cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "api_key" cascade;`);
  }
}
