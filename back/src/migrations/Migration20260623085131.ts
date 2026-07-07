import { Migration } from '@mikro-orm/migrations';

export class Migration20260623085131 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "user_setting" ("id" uuid not null, "user_id" uuid not null, "preset" varchar(255) not null default 'Aura', "primary" varchar(255) not null default 'yellow', "surface" varchar(255) not null default 'stone', "dark_theme" boolean not null default false, "menu_mode" varchar(255) not null default 'static', "locale" varchar(255) not null default 'la', "updated_at" timestamptz null, constraint "user_setting_pkey" primary key ("id"));`);
    this.addSql(`alter table "user_setting" add constraint "user_setting_user_id_unique" unique ("user_id");`);

    this.addSql(`alter table "user_setting" add constraint "user_setting_user_id_foreign" foreign key ("user_id") references "app_user" ("id") on update cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "user_setting" cascade;`);
  }

}
