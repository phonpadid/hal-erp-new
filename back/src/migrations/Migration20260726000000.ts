import { Migration } from '@mikro-orm/migrations';

/**
 * Inventory foundation: warehouses and the stock ledger. The same shape budget-control already
 * proved — an append-only ledger that is the truth, plus a derived balance row that exists to be
 * locked and to save an aggregate scan.
 *
 * - `warehouse` — a stock location owned by one company, `code` unique per company. Stock never
 *   crosses a company boundary (invariant 1), so there is no inter-company transfer to model.
 * - `stock_txn` — APPEND-ONLY (invariant 2), like `budget_txn`. `qty` is always positive;
 *   direction comes from `txn_type`, so a SUM by type is unambiguous and no stray sign can
 *   quietly invert a movement. `unit_cost` is 6 decimals because it is a rate, not a posted
 *   amount — rounding it to 2 lets error accumulate across many small receipts.
 * - `stock_balance` — a projection of the ledger, unique per (company, item, warehouse). It is
 *   the row taken FOR UPDATE before availability is checked or cost re-averaged. Replaying
 *   `stock_txn` must reproduce it exactly (invariant 3).
 * - `item.is_stock_tracked` — whether the good is tracked in a warehouse at all. On the group
 *   `item` because being a physical thing is a property of the thing, not of a company's
 *   relationship to it.
 * - `document_type.requires_warehouse` + `document.warehouse_id` / `dest_warehouse_id` — a stock
 *   movement's source and destination, carried on the document so they travel the same approval
 *   steps as the quantity.
 * - `account_role.role` widens to accept INVENTORY / GRNI / INVENTORY_ADJUSTMENT /
 *   INVENTORY_IN_TRANSIT so GL accounts stay config-driven (invariant 7), never hardcoded codes.
 *   GRNI (goods received not invoiced) is the liability between capitalizing goods at receipt and
 *   paying for them — without it a receipt entry has no credit side and cannot balance.
 *
 * Writes no ledger row and needs no backfill: `is_stock_tracked` defaults false, so every
 * existing item, document type, and receipt behaves exactly as before until a company opts in by
 * creating a warehouse and marking items stockable. `down` reverses cleanly.
 */
export class Migration20260726000000 extends Migration {
  override async up(): Promise<void> {
    // Enums are text + check constraint in this schema (not native PG types), so widening one
    // means replacing its constraint.
    this.addSql(`alter table "account_role" drop constraint if exists "account_role_role_check";`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_role_check" check ("role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS', 'VAT_INPUT', 'WHT_PAYABLE', 'INVENTORY', 'GRNI', 'INVENTORY_ADJUSTMENT', 'INVENTORY_IN_TRANSIT'));`,
    );

    this.addSql(`create table "warehouse" (
      "id" uuid not null,
      "company_id" uuid not null,
      "code" varchar(255) not null,
      "name" varchar(255) not null,
      "is_active" boolean not null default true,
      constraint "warehouse_pkey" primary key ("id")
    );`);
    // Per company, not globally: two companies may each run a warehouse called MAIN.
    this.addSql(
      `alter table "warehouse" add constraint "warehouse_company_id_code_unique" unique ("company_id", "code");`,
    );
    this.addSql(
      `alter table "warehouse" add constraint "warehouse_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );

    this.addSql(`create table "stock_txn" (
      "id" uuid not null,
      "company_id" uuid not null,
      "item_id" uuid not null,
      "warehouse_id" uuid not null,
      "txn_type" text check ("txn_type" in ('RESERVE', 'RELEASE', 'ISSUE', 'RECEIVE', 'ADJUST_INCREASE', 'ADJUST_DECREASE', 'TRANSFER_OUT', 'TRANSFER_IN')) not null,
      "qty" numeric(15,4) not null,
      "unit_cost" numeric(15,6) null,
      "document_id" uuid null,
      "document_line_id" uuid null,
      "remark" varchar(255) null,
      "created_by" uuid null,
      "created_at" timestamptz(6) null,
      constraint "stock_txn_pkey" primary key ("id")
    );`);
    // The read path is always "this company's movements for this item in this warehouse".
    this.addSql(
      `create index "stock_txn_company_id_item_id_warehouse_id_index" on "stock_txn" ("company_id", "item_id", "warehouse_id");`,
    );
    this.addSql(`create index "stock_txn_document_id_index" on "stock_txn" ("document_id");`);
    // Direction lives in txn_type; a negative qty would make every SUM ambiguous.
    this.addSql(`alter table "stock_txn" add constraint "stock_txn_qty_positive" check ("qty" > 0);`);
    this.addSql(
      `alter table "stock_txn" add constraint "stock_txn_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "stock_txn" add constraint "stock_txn_item_id_foreign" foreign key ("item_id") references "item" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "stock_txn" add constraint "stock_txn_warehouse_id_foreign" foreign key ("warehouse_id") references "warehouse" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "stock_txn" add constraint "stock_txn_document_id_foreign" foreign key ("document_id") references "document" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "stock_txn" add constraint "stock_txn_document_line_id_foreign" foreign key ("document_line_id") references "document_line" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "stock_txn" add constraint "stock_txn_created_by_foreign" foreign key ("created_by") references "app_user" ("id") on update cascade on delete set null;`,
    );

    this.addSql(`create table "stock_balance" (
      "id" uuid not null,
      "company_id" uuid not null,
      "item_id" uuid not null,
      "warehouse_id" uuid not null,
      "qty_on_hand" numeric(15,4) not null default 0,
      "qty_reserved" numeric(15,4) not null default 0,
      "avg_cost" numeric(15,6) not null default 0,
      "total_value" numeric(15,2) not null default 0,
      "updated_at" timestamptz(6) null,
      constraint "stock_balance_pkey" primary key ("id")
    );`);
    // One balance row per pair — it is the lock target, so a duplicate would let two
    // transactions each lock a different row and both believe there is stock.
    this.addSql(
      `alter table "stock_balance" add constraint "stock_balance_company_id_item_id_warehouse_id_unique" unique ("company_id", "item_id", "warehouse_id");`,
    );
    this.addSql(
      `alter table "stock_balance" add constraint "stock_balance_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "stock_balance" add constraint "stock_balance_item_id_foreign" foreign key ("item_id") references "item" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "stock_balance" add constraint "stock_balance_warehouse_id_foreign" foreign key ("warehouse_id") references "warehouse" ("id") on update cascade;`,
    );

    this.addSql(`alter table "item" add column "is_stock_tracked" boolean not null default false;`);

    // Defaults false, so every existing type submits exactly as before until a company opts in.
    this.addSql(`alter table "document_type" add column "requires_warehouse" boolean not null default false;`);

    // Source and destination of a stock movement, carried on the document so they travel the same
    // approval steps as the quantity.
    this.addSql(`alter table "document" add column "warehouse_id" uuid null;`);
    this.addSql(`alter table "document" add column "dest_warehouse_id" uuid null;`);
    this.addSql(
      `alter table "document" add constraint "document_warehouse_id_foreign" foreign key ("warehouse_id") references "warehouse" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "document" add constraint "document_dest_warehouse_id_foreign" foreign key ("dest_warehouse_id") references "warehouse" ("id") on update cascade on delete set null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "document" drop constraint if exists "document_dest_warehouse_id_foreign";`);
    this.addSql(`alter table "document" drop constraint if exists "document_warehouse_id_foreign";`);
    this.addSql(`alter table "document" drop column if exists "dest_warehouse_id";`);
    this.addSql(`alter table "document" drop column if exists "warehouse_id";`);
    this.addSql(`alter table "document_type" drop column if exists "requires_warehouse";`);
    this.addSql(`alter table "item" drop column if exists "is_stock_tracked";`);
    this.addSql(`drop table if exists "stock_balance" cascade;`);
    this.addSql(`drop table if exists "stock_txn" cascade;`);
    this.addSql(`drop table if exists "warehouse" cascade;`);
    this.addSql(`alter table "account_role" drop constraint if exists "account_role_role_check";`);
    this.addSql(
      `alter table "account_role" add constraint "account_role_role_check" check ("role" in ('CASH_CLEARING', 'FX_GAIN', 'FX_LOSS', 'VAT_INPUT', 'WHT_PAYABLE'));`,
    );
  }
}
