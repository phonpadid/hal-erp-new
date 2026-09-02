import { Migration } from '@mikro-orm/migrations';

/**
 * Close the three places where the database and the entities disagreed.
 *
 * The specs build their schema from the entities and production builds it from the migrations,
 * so a difference between the two is invisible to a green suite. `schema:update --dump` is the
 * only thing that sees it, and it saw these three. None of them had bitten yet; all three are
 * the kind that bite in production, at a moment nobody chose.
 *
 * 1. `pending_successor.status` — the entity declares an enum of PENDING / DONE / FAILED. The
 *    column was a bare varchar, so any string at all could be written and the outbox worker
 *    would silently never pick it up. All five existing rows are DONE.
 *
 * 2. `payment_batch_line.wht_amount` — the entity has a default of 0 and no `nullable`, so it
 *    reads and writes this as a number that always exists; `netAmount()` only survives a null
 *    because it coalesces defensively. A null withholding amount has no meaning: a line either
 *    withholds something or withholds zero. Both existing rows already carry a value.
 *
 * 3. `document_settlement.id` — carries a `gen_random_uuid()` default that no other table has;
 *    of the 74 tables, this one was alone in defining it. The ORM generates the id, so the
 *    default never fires. It came in with the settlement table three migrations ago and is
 *    removed here so the schema has one convention rather than one convention and an exception.
 *
 * Nothing here changes a value. The enum check and the not-null both hold for every row present.
 */
export class Migration20260807000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "pending_successor" alter column "status" type text using ("status"::text);`);
    this.addSql(
      `alter table "pending_successor" add constraint "pending_successor_status_check" ` +
        `check ("status" in ('PENDING', 'DONE', 'FAILED'));`,
    );

    this.addSql(`update "payment_batch_line" set "wht_amount" = 0 where "wht_amount" is null;`);
    this.addSql(`alter table "payment_batch_line" alter column "wht_amount" set not null;`);

    this.addSql(`alter table "document_settlement" alter column "id" drop default;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document_settlement" alter column "id" set default gen_random_uuid();`);

    this.addSql(`alter table "payment_batch_line" alter column "wht_amount" drop not null;`);

    this.addSql(`alter table "pending_successor" drop constraint "pending_successor_status_check";`);
    this.addSql(
      `alter table "pending_successor" alter column "status" type varchar(255) using ("status"::varchar(255));`,
    );
  }
}
