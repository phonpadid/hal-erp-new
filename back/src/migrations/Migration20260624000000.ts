import { Migration } from '@mikro-orm/migrations';

/**
 * Periodize quota usage so reset cycles (MONTHLY / QUARTERLY / YEARLY) work, and add a
 * per-quota carry-forward policy flag.
 *
 * - quota.carry_forward          — allow rolling unused balance across periods.
 * - quota_usage.period_year      — reset period year (0 = NONE / no reset).
 * - quota_usage.period_index     — YEARLY=1, QUARTERLY 1-4, MONTHLY 1-12, NONE=0.
 *
 * Backfills existing usage rows from created_at against each quota's reset_cycle.
 */
export class Migration20260624000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "quota" add column "carry_forward" boolean not null default true;`);
    this.addSql(`alter table "quota_usage" add column "period_year" int not null default 0;`);
    this.addSql(`alter table "quota_usage" add column "period_index" smallint not null default 0;`);

    // Backfill period_year / period_index from created_at per the quota's reset_cycle.
    this.addSql(`
      update "quota_usage" u set
        "period_year" = case
          when q."reset_cycle" = 'NONE' then 0
          else extract(year from u."created_at")::int
        end,
        "period_index" = case
          when q."reset_cycle" = 'YEARLY' then 1
          when q."reset_cycle" = 'QUARTERLY' then ceil(extract(month from u."created_at") / 3.0)::int
          when q."reset_cycle" = 'MONTHLY' then extract(month from u."created_at")::int
          else 0
        end
      from "quota" q
      where u."quota_id" = q."id" and u."created_at" is not null;
    `);

    this.addSql(
      `create index "quota_usage_quota_id_period_year_period_index_index" on "quota_usage" ("quota_id", "period_year", "period_index");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "quota_usage_quota_id_period_year_period_index_index";`);
    this.addSql(`alter table "quota_usage" drop column "period_index";`);
    this.addSql(`alter table "quota_usage" drop column "period_year";`);
    this.addSql(`alter table "quota" drop column "carry_forward";`);
  }
}
