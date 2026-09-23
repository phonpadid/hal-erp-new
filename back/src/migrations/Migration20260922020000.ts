import { Migration } from '@mikro-orm/migrations';

/**
 * Vendor and item codes are issued by the system, not typed.
 *
 * `master_sequence` is the group-wide counter behind `vendor_code` / `item_code` — one row per
 * kind, locked FOR UPDATE before increment like `doc_running_number`. Its own table because that
 * counter is keyed by company + document type + year, and the registries are group-wide.
 *
 * Each row is seeded at the highest number an existing code of the same pattern already uses, so
 * an issued code never collides with a legacy one. Codes outside the pattern (`213`,
 * `BANKPICK-DEMO`) cannot collide by construction and are left as they are.
 */
export class Migration20260922020000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "master_sequence" ("kind" varchar(255) not null, "current_no" int not null default 0, ` +
        `constraint "master_sequence_pkey" primary key ("kind"));`,
    );
    this.addSql(
      `insert into "master_sequence" ("kind", "current_no") values ` +
        `('VENDOR', coalesce((select max(substring("vendor_code" from 3)::int) from "vendor" where "vendor_code" ~ '^V-[0-9]+$'), 0)), ` +
        `('ITEM', coalesce((select max(substring("item_code" from 3)::int) from "item" where "item_code" ~ '^I-[0-9]+$'), 0));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "master_sequence";`);
  }
}
