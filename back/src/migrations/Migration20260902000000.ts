import { Migration } from '@mikro-orm/migrations';

/**
 * A budget stops being identified by a GL account, and the plan's structure gets a table of its own.
 *
 * The old key `(fiscal_year_id, department_id, gl_account)` asserted that a budget line and an
 * account are the same thing seen twice. The customer's books say otherwise in both directions at
 * once: one journal voucher posts thirteen lines to account `658.0007` spanning fuel, repairs and
 * registration budgets inside one department, while one budget line (`vehicle instalments`) posts to
 * a liability account and an expense account. `Account A → Budget X`, `Account B → Budget X` and
 * `Account A → Budget Y` cannot coexist while the account sits inside the identity.
 *
 * The structure lives in `budget_node`, and a node is NOT a budget. A category has no amount, is
 * charged by nothing, and is approved by nobody on its own. An earlier version of this migration
 * made categories budget rows holding no amount; it worked, and it left five separate readers of
 * the budget table having to know which rows were not budgets.
 *
 *   1. create `budget_node`
 *   2. mint one node per existing budget, taking its `gl_account` as the node's code — collision-free
 *      WITHIN the old unique key by construction, because `gl_account` WAS that key, so this can
 *      never collide with itself
 *   3. point `budget.node_id` at it and move the partial unique index onto the node
 *   4. make `gl_account` nullable WITHOUT nulling a single value, so step 3 can be reversed
 *   5. move `budget_control_point` from the account tree to the node tree
 *
 * Step 5 preserves coverage exactly rather than approximately. An existing point sitting on account
 * node `61` governs every budget whose account descends from `61`; after this migration budgets have
 * no account ancestry at all. So for each point we mint a node standing for it and reparent the
 * nodes of the budgets it governed underneath — the governed set is then identical by construction,
 * not by inspection.
 */
export class Migration20260902000000 extends Migration {
  override async up(): Promise<void> {
    // ── 1. the plan's structure ───────────────────────────────────────────────────────────────
    this.addSql(`
      create table "budget_node" (
        "id" uuid not null default gen_random_uuid(),
        "fiscal_year_id" uuid not null,
        "code" varchar(255) not null,
        "name" varchar(255) null,
        "parent_id" uuid null,
        constraint "budget_node_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "budget_node" add constraint "budget_node_fiscal_year_id_foreign" ` +
        `foreign key ("fiscal_year_id") references "fiscal_year" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "budget_node" add constraint "budget_node_parent_id_foreign" ` +
        `foreign key ("parent_id") references "budget_node" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "budget_node" add constraint "budget_node_fy_code_unique" ` +
        `unique ("fiscal_year_id", "code");`,
    );
    this.addSql(`create index "budget_node_parent_id_index" on "budget_node" ("parent_id");`);

    // ── 2–3. every budget gets the node its account code names ────────────────────────────────
    this.addSql(`alter table "budget" add column "node_id" uuid null;`);
    this.addSql(`
      insert into "budget_node" ("id", "fiscal_year_id", "code", "name")
      select distinct on (b."fiscal_year_id", b."gl_account")
             gen_random_uuid(), b."fiscal_year_id", b."gl_account", b."budget_name"
      from "budget" b
      on conflict ("fiscal_year_id", "code") do nothing;
    `);
    this.addSql(`
      update "budget" b set "node_id" = n."id"
      from "budget_node" n
      where n."fiscal_year_id" = b."fiscal_year_id"
        and n."code" = b."gl_account";
    `);
    this.addSql(`alter table "budget" alter column "node_id" set not null;`);
    this.addSql(
      `alter table "budget" add constraint "budget_node_id_foreign" ` +
        `foreign key ("node_id") references "budget_node" ("id") on update cascade;`,
    );

    this.addSql(`drop index if exists "budget_dimension_unique_unless_rejected";`);
    this.addSql(
      `create unique index "budget_dimension_unique_unless_rejected" on "budget" ` +
        `("node_id", "department_id") where "status" <> 'REJECTED';`,
    );

    // ── 4. the account is demoted, not discarded ──────────────────────────────────────────────
    this.addSql(`alter table "budget" alter column "gl_account" drop not null;`);

    // ── 5. control points move to the node tree, preserving the governed set exactly ──────────
    this.addSql(`alter table "budget_control_point" add column "budget_node_id" uuid null;`);

    // One node per existing control point, standing for what that point used to govern. Its code
    // is derived from the point's id so it cannot collide with a node minted in step 2.
    this.addSql(`
      insert into "budget_node" ("id", "fiscal_year_id", "code", "name")
      select gen_random_uuid(), cp."fiscal_year_id",
             'CP-' || left(cp."id"::text, 8), 'Migrated control point'
      from "budget_control_point" cp;
    `);
    this.addSql(`
      update "budget_control_point" cp
      set "budget_node_id" = n."id"
      from "budget_node" n
      where n."code" = 'CP-' || left(cp."id"::text, 8)
        and n."fiscal_year_id" = cp."fiscal_year_id";
    `);

    // Reparent the node of every budget the point used to govern. "Used to govern" is the old rule
    // read literally: the point's account node is the budget's account or an ancestor of it, and
    // its department node is the budget's department or an ancestor of it.
    this.addSql(`
      with recursive account_up as (
        select a."id" as node_id, a."id" as start_id, a."parent_id" from "account" a
        union all
        select p."id", au."start_id", p."parent_id"
          from account_up au join "account" p on p."id" = au."parent_id"
      ), department_up as (
        select d."id" as node_id, d."id" as start_id, d."parent_dept_id" from "department" d
        union all
        select p."id", du."start_id", p."parent_dept_id"
          from department_up du join "department" p on p."id" = du."parent_dept_id"
      )
      update "budget_node" n
      set "parent_id" = cp."budget_node_id"
      from "budget_control_point" cp, "budget" b
      where b."node_id" = n."id"
        and cp."is_active" = true
        and cp."fiscal_year_id" = b."fiscal_year_id"
        and exists (
          select 1 from account_up au
          where au."start_id" = b."account_id" and au."node_id" = cp."account_node_id"
        )
        and exists (
          select 1 from department_up du
          where du."start_id" = b."department_id" and du."node_id" = cp."department_node_id"
        )
        and n."parent_id" is null
        and n."id" <> cp."budget_node_id";
    `);

    this.addSql(`alter table "budget_control_point" alter column "budget_node_id" set not null;`);
    this.addSql(
      `alter table "budget_control_point" add constraint "budget_control_point_budget_node_id_foreign" ` +
        `foreign key ("budget_node_id") references "budget_node" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "budget_control_point" ` +
        `drop constraint if exists "budget_control_point_company_id_fiscal_year_id_acc_c9ba3_unique";`,
    );
    this.addSql(
      `alter table "budget_control_point" drop constraint if exists "budget_control_point_account_node_id_foreign";`,
    );
    this.addSql(`alter table "budget_control_point" drop column "account_node_id";`);
    this.addSql(
      `alter table "budget_control_point" add constraint ` +
        `"budget_control_point_company_fy_budget_dept_unique" ` +
        `unique ("company_id", "fiscal_year_id", "budget_node_id", "department_node_id");`,
    );
  }

  override async down(): Promise<void> {
    // The account a point used to sit on is recoverable from a budget it governs — its own node
    // carries no account, and the nodes minted for points carry nothing at all.
    this.addSql(
      `alter table "budget_control_point" drop constraint if exists "budget_control_point_company_fy_budget_dept_unique";`,
    );
    this.addSql(`alter table "budget_control_point" add column "account_node_id" uuid null;`);
    this.addSql(`
      update "budget_control_point" cp
      set "account_node_id" = (
        select b."account_id" from "budget" b join "budget_node" n on n."id" = b."node_id"
        where (n."id" = cp."budget_node_id" or n."parent_id" = cp."budget_node_id")
          and b."account_id" is not null
        limit 1
      );
    `);
    this.addSql(
      `alter table "budget_control_point" drop constraint if exists "budget_control_point_budget_node_id_foreign";`,
    );
    this.addSql(`alter table "budget_control_point" drop column "budget_node_id";`);

    this.addSql(`drop index if exists "budget_dimension_unique_unless_rejected";`);
    this.addSql(`alter table "budget" drop constraint if exists "budget_node_id_foreign";`);
    this.addSql(`alter table "budget" drop column "node_id";`);
    // `gl_account` kept every one of its values on the way up, which is what makes this safe.
    this.addSql(`alter table "budget" alter column "gl_account" set not null;`);
    this.addSql(
      `create unique index "budget_dimension_unique_unless_rejected" on "budget" ` +
        `("fiscal_year_id", "department_id", "gl_account") where "status" <> 'REJECTED';`,
    );

    this.addSql(`drop table if exists "budget_node" cascade;`);
  }
}
