import { Migration } from '@mikro-orm/migrations';

/**
 * Introduce `budget_control_point` — WHERE budget availability is checked, split from WHERE it is
 * posted.
 *
 * Until now the two were the same row: `reserve` locked one `budget`, summed that budget's
 * `budget_txn`, and refused on that budget alone. An organisation that plans at line level but
 * manages money at category or department level had no way to say so, and the only escape from a
 * line-level refusal is to charge the spend to a line that still has room — which destroys the
 * reporting the budget existed to produce.
 *
 * The seed makes this migration behaviour-preserving. Every existing budget gets one control point
 * at its OWN account and department, so each governed set has exactly one member and every check
 * and refusal is arithmetically identical to checking that budget row. Moving control upward is
 * then configuration, not a deployment.
 *
 * Two things happen before the seed can be honest:
 *
 * 1. `budget.account_id` has been nullable since Migration20260707000000 ("nullable during
 *    backfill") and no migration ever backfilled it. A control point is keyed on an account node,
 *    so a budget with no resolved account cannot be given one. The backfill here is the resolution
 *    the write path already performs — match `account.code` to `budget.gl_account` within the
 *    budget's own company, reached through `fiscal_year.company_id`.
 *
 * 2. Coverage is then VERIFIED, and the migration raises if any ACTIVE budget was left uncovered.
 *    This is deliberate: an uncovered budget has no row to lock and no ceiling to check, so it
 *    would be spendable without limit and without ever raising an error. That failure is invisible
 *    at runtime, which is exactly why it has to be loud here.
 */
export class Migration20260810000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "budget_control_point" (
        "id" uuid not null,
        "company_id" uuid not null,
        "fiscal_year_id" uuid not null,
        "account_node_id" uuid not null,
        "department_node_id" uuid not null,
        "cap_amount" numeric(15,2) null,
        "tolerance_json" text not null,
        "is_active" boolean not null default true,
        constraint "budget_control_point_pkey" primary key ("id")
      );
    `);

    this.addSql(
      `alter table "budget_control_point" add constraint "budget_control_point_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "budget_control_point" add constraint "budget_control_point_fiscal_year_id_foreign" foreign key ("fiscal_year_id") references "fiscal_year" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "budget_control_point" add constraint "budget_control_point_account_node_id_foreign" foreign key ("account_node_id") references "account" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "budget_control_point" add constraint "budget_control_point_department_node_id_foreign" foreign key ("department_node_id") references "department" ("id") on update cascade;`,
    );

    this.addSql(
      `alter table "budget_control_point" add constraint "budget_control_point_company_id_fiscal_year_id_account_node_id_department_node_id_unique" unique ("company_id", "fiscal_year_id", "account_node_id", "department_node_id");`,
    );
    this.addSql(
      `create index "budget_control_point_company_id_fiscal_year_id_index" on "budget_control_point" ("company_id", "fiscal_year_id");`,
    );

    // (1) Backfill budget.account_id where the write path never had a chance to set it. Same
    // resolution rule as BudgetService: active, postable account whose code equals gl_account,
    // in the budget's own company.
    this.addSql(`
      update "budget" b
      set "account_id" = a."id"
      from "fiscal_year" fy, "account" a
      where b."account_id" is null
        and fy."id" = b."fiscal_year_id"
        and a."company_id" = fy."company_id"
        and a."code" = b."gl_account"
        and a."is_active" = true
        and a."is_postable" = true;
    `);

    // (2) Seed one self-scoped control point per budget. control_policy is translated exactly:
    // HARD_STOP blocked at the ceiling, SOFT_WARNING warned at it — so previously configured
    // behaviour is reproduced, not approximated.
    this.addSql(`
      insert into "budget_control_point"
        ("id", "company_id", "fiscal_year_id", "account_node_id", "department_node_id",
         "cap_amount", "tolerance_json", "is_active")
      select
        gen_random_uuid(),
        fy."company_id",
        b."fiscal_year_id",
        b."account_id",
        b."department_id",
        null,
        case when b."control_policy" = 'SOFT_WARNING'
             then '[{"at":100,"action":"WARN"}]'
             else '[{"at":100,"action":"BLOCK"}]'
        end,
        true
      from "budget" b
      join "fiscal_year" fy on fy."id" = b."fiscal_year_id"
      where b."account_id" is not null
      on conflict ("company_id", "fiscal_year_id", "account_node_id", "department_node_id")
      do nothing;
    `);

    // (3) Prove the coverage invariant instead of assuming it. A budget left uncovered here would
    // be spendable without limit, silently.
    this.addSql(`
      do $$
      declare
        uncovered_count int;
        sample text;
      begin
        select count(*), coalesce(min(b."id"::text), '')
          into uncovered_count, sample
        from "budget" b
        where b."status" = 'ACTIVE'
          and not exists (
            select 1 from "budget_control_point" cp
            where cp."fiscal_year_id" = b."fiscal_year_id"
              and cp."account_node_id" = b."account_id"
              and cp."department_node_id" = b."department_id"
              and cp."is_active" = true
          );
        if uncovered_count > 0 then
          raise exception
            'budget_control_point seed left % ACTIVE budget row(s) with no governing control point (e.g. budget %). Their gl_account does not resolve to an active, postable account in their company, so no account node could be keyed. Resolve those accounts, then re-run.',
            uncovered_count, sample;
        end if;
      end $$;
    `);
  }

  override async down(): Promise<void> {
    // budget.account_id is deliberately NOT un-backfilled: it is the value the write path would
    // have produced anyway, and reverting it would re-create the drift this migration closed.
    this.addSql(`drop table if exists "budget_control_point" cascade;`);
  }
}
