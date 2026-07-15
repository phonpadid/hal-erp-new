import { Migration } from '@mikro-orm/migrations';

/**
 * Create `job_level` — per-company position-level master (invariant 1), so job levels are
 * configuration rather than a hardcoded enum (invariant 7). `code` is referenced by
 * `employee.job_level` and `workflow_step.condition_json`; `rank` orders seniority for the
 * workflow-step `minRank` condition.
 *
 * Data-preserving: the `up` seeds each company's distinct existing `employee.job_level` values as
 * rows (normalized to trimmed-uppercase `code`, original kept as `name`, ranks spaced by 10),
 * normalizes `employee.job_level` to the seeded code, then asserts every non-empty
 * `employee.job_level` resolves to a `(company_id, code)` row (aborting the transaction if not).
 * Companies with no existing values get a starter ladder matching the retired JOB_LEVELS set so
 * the master-data admin is not empty and pre-existing "MANAGER"-style step conditions still resolve.
 */
export class Migration20260717000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "job_level" (
      "id" uuid not null,
      "company_id" uuid not null,
      "code" varchar(255) not null,
      "name" varchar(255) not null,
      "rank" int not null,
      "is_active" boolean not null default true,
      constraint "job_level_pkey" primary key ("id")
    );`);
    this.addSql(
      `alter table "job_level" add constraint "job_level_company_id_code_unique" unique ("company_id", "code");`,
    );
    this.addSql(`create index "job_level_company_id_index" on "job_level" ("company_id");`);
    this.addSql(
      `alter table "job_level" add constraint "job_level_company_id_foreign" foreign key ("company_id") references "company" ("id") on update cascade;`,
    );

    // 1. Seed distinct existing employee.job_level values per company (normalized code = trimmed
    //    uppercase; name = an original spelling; rank spaced by 10 in code order).
    this.addSql(`
      insert into "job_level" ("id", "company_id", "code", "name", "rank", "is_active")
      select gen_random_uuid(), t.company_id, t.code, t.name, t.rank, true
      from (
        select e."company_id" as company_id,
               upper(trim(e."job_level")) as code,
               min(e."job_level") as name,
               (row_number() over (
                 partition by e."company_id" order by upper(trim(e."job_level"))
               )) * 10 as rank
        from "employee" e
        where e."job_level" is not null and trim(e."job_level") <> ''
        group by e."company_id", upper(trim(e."job_level"))
      ) t
      on conflict ("company_id", "code") do nothing;
    `);

    // 2. Log any value that had to be folded (normalized differs from the stored spelling).
    this.addSql(`
      do $$
      declare r record;
      begin
        for r in
          select distinct e."company_id", e."job_level" as original, upper(trim(e."job_level")) as code
          from "employee" e
          where e."job_level" is not null and trim(e."job_level") <> ''
            and e."job_level" <> upper(trim(e."job_level"))
        loop
          raise notice 'job_level migration: folded employee.job_level % -> % (company %)',
            r.original, r.code, r.company_id;
        end loop;
      end $$;
    `);

    // 3. Normalize employee.job_level to the seeded code.
    this.addSql(`
      update "employee"
      set "job_level" = upper(trim("job_level"))
      where "job_level" is not null and trim("job_level") <> '';
    `);

    // 4. Assert every non-empty employee.job_level now resolves to a job_level row (else abort).
    this.addSql(`
      do $$
      declare cnt int;
      begin
        select count(*) into cnt
        from "employee" e
        where e."job_level" is not null and trim(e."job_level") <> ''
          and not exists (
            select 1 from "job_level" j
            where j."company_id" = e."company_id" and j."code" = e."job_level"
          );
        if cnt > 0 then
          raise exception 'job_level migration: % employee(s) have an unresolved job_level', cnt;
        end if;
      end $$;
    `);

    // 5. Starter ladder (retired JOB_LEVELS names/ranks) for companies that ended up with no levels.
    this.addSql(`
      insert into "job_level" ("id", "company_id", "code", "name", "rank", "is_active")
      select gen_random_uuid(), c."id", v.code, v.name, v.rank, true
      from "company" c
      cross join (values
        ('STAFF', 'Staff', 10),
        ('SUPERVISOR', 'Supervisor', 20),
        ('MANAGER', 'Manager', 30),
        ('DIRECTOR', 'Director', 40),
        ('EXECUTIVE', 'Executive', 50)
      ) as v(code, name, rank)
      where not exists (select 1 from "job_level" j where j."company_id" = c."id")
      on conflict ("company_id", "code") do nothing;
    `);
  }

  override async down(): Promise<void> {
    // Employee.job_level values remain normalized (trimmed-uppercase). The original spellings are
    // recoverable from the up migration's RAISE NOTICE log if a full revert is required.
    this.addSql(`drop table if exists "job_level" cascade;`);
  }
}
