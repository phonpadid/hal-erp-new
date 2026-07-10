import { Migration } from '@mikro-orm/migrations';

/**
 * Approval signatures + PDF export. Adds:
 *  - `user_signature`: a user's reusable, IMMUTABLE signature image (object key only; bytes
 *    live in S3/MinIO). Global to app_user — no company_id.
 *  - `app_user.current_signature_id`: the user's active signature.
 *  - `approval_log.signature_id`: the signature snapshot locked onto an APPROVE row.
 *  - `workflow_step.show_signature_on_pdf`: whether the step's signature is drawn on the PDF.
 * All additive/nullable (the flag defaults true) — no backfill; existing rows keep working.
 */
export class Migration20260709000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "user_signature" (
      "id" uuid not null,
      "user_id" uuid not null,
      "file_path" varchar(255) not null,
      "mime_type" varchar(255) null,
      "file_size_kb" int null,
      "uploaded_at" timestamptz null,
      constraint "user_signature_pkey" primary key ("id")
    );`);
    this.addSql(
      `create index "user_signature_user_id_index" on "user_signature" ("user_id");`,
    );
    this.addSql(
      `alter table "user_signature" add constraint "user_signature_user_id_foreign" foreign key ("user_id") references "app_user" ("id") on update cascade;`,
    );

    this.addSql(`alter table "app_user" add column "current_signature_id" uuid null;`);
    this.addSql(
      `alter table "app_user" add constraint "app_user_current_signature_id_foreign" foreign key ("current_signature_id") references "user_signature" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`alter table "approval_log" add column "signature_id" uuid null;`);
    this.addSql(
      `alter table "approval_log" add constraint "approval_log_signature_id_foreign" foreign key ("signature_id") references "user_signature" ("id") on update cascade on delete set null;`,
    );

    this.addSql(
      `alter table "workflow_step" add column "show_signature_on_pdf" boolean not null default true;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "workflow_step" drop column "show_signature_on_pdf";`);
    this.addSql(
      `alter table "approval_log" drop constraint if exists "approval_log_signature_id_foreign";`,
    );
    this.addSql(`alter table "approval_log" drop column "signature_id";`);
    this.addSql(
      `alter table "app_user" drop constraint if exists "app_user_current_signature_id_foreign";`,
    );
    this.addSql(`alter table "app_user" drop column "current_signature_id";`);
    this.addSql(`drop table if exists "user_signature" cascade;`);
  }
}
