import { Migration } from '@mikro-orm/migrations';

/**
 * Create `api_key` — long-lived machine credential for external (M2M) access. Company-scoped
 * (invariant 1): a key is bound to exactly one company and one `app_user`, and on each request
 * resolves to the same company-context principal that user would get by logging in. Only the
 * SHA-256 `secret_hash` is stored; the raw secret is shown once at issuance and never persisted.
 *
 * `prefix` is the public, non-secret lookup id — unique (a prefix must identify at most one key)
 * and separately indexed for the per-request lookup on the authentication path. `revoked_at` is a
 * state change rather than a delete, so the `(company_id, revoked_at)` index serves the
 * company-scoped "active keys" listing. `user_id` is indexed for revoke-on-offboarding sweeps.
 *
 * Pure additive: a new table with no backfill, so `down` drops it.
 */
export class Migration20260720000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "api_key" (
      "id" uuid not null,
      "company_id" uuid not null,
      "user_id" uuid not null,
      "name" varchar(255) not null,
      "prefix" varchar(255) not null,
      "secret_hash" varchar(255) not null,
      "created_by" uuid not null,
      "expires_at" timestamptz(6) null,
      "revoked_at" timestamptz(6) null,
      "last_used_at" timestamptz(6) null,
      "created_at" timestamptz(6) null,
      constraint "api_key_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "api_key" add constraint "api_key_prefix_unique" unique ("prefix");`,
    );
    this.addSql(`create index "api_key_prefix_index" on "api_key" ("prefix");`);
    this.addSql(
      `create index "api_key_company_id_revoked_at_index" on "api_key" ("company_id", "revoked_at");`,
    );
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
