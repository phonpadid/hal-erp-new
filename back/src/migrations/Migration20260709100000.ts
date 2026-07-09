import { Migration } from '@mikro-orm/migrations';

/**
 * 1:1 profile images for users and companies (object key only; bytes live in S3/MinIO).
 * Additive/nullable — no backfill; existing rows keep working with no image.
 */
export class Migration20260709100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "app_user" add column "profile_image_path" varchar(255) null;`);
    this.addSql(`alter table "company" add column "profile_image_path" varchar(255) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "app_user" drop column "profile_image_path";`);
    this.addSql(`alter table "company" drop column "profile_image_path";`);
  }
}
