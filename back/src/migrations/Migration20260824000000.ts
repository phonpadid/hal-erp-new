import { Migration } from '@mikro-orm/migrations';

/**
 * Give every journal voucher the document it now rides on.
 *
 * A voucher used to hold its own state and its own single approval. It is a document now: numbered,
 * routed through a workflow whose steps engage by amount, and approved through the same engine and
 * the same append-only `approval_log` as everything else. This migration moves what is already in
 * the table into that shape rather than requiring the approval queue be empty at deploy time — a
 * deployment that demands an empty queue is one that happens at 3am or does not happen.
 *
 * Four things move, in order:
 *
 *  1. every voucher gets a `document` of the company's POST_JOURNAL type, in the status matching
 *     its own — pending ones SUBMITTED and routed from the first applicable step, decided ones in
 *     their terminal state, so an approved voucher's entry can still be traced back to a route;
 *  2. decisions already made become `approval_log` rows, because that is where a voucher's audit
 *     trail lives now. A withdrawal becomes a CANCELLED document and no log row, which is exactly
 *     what cancelling a document writes today;
 *  3. `document_id` becomes NOT NULL once it is filled;
 *  4. the columns the document now owns are dropped.
 *
 * A company with no POST_JOURNAL document type and no vouchers is untouched. A company with
 * vouchers and no such type FAILS, loudly: silently leaving those vouchers unroutable would hide
 * unposted accounting behind a successful deploy.
 */
export class Migration20260824000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "journal_voucher" add column "document_id" uuid null;`);
    this.addSql(
      `alter table "journal_voucher" add constraint "journal_voucher_document_id_foreign" ` +
        `foreign key ("document_id") references "document" ("id") on update cascade;`,
    );

    // A company that has vouchers to move but no type to move them onto cannot be migrated: the
    // vouchers would exist with no route and no way to post.
    this.addSql(`do $$
      declare missing text;
      begin
        select string_agg(distinct c.code, ', ') into missing
        from "journal_voucher" v
        join "company" c on c.id = v.company_id
        where not exists (
          select 1 from "document_type" dt
          where dt.company_id = v.company_id and dt.post_action = 'POST_JOURNAL' and dt.is_active
        );
        if missing is not null then
          raise exception 'Companies % have journal vouchers but no active POST_JOURNAL document type; seed one before migrating', missing;
        end if;
      end $$;`);

    // 1. A document per voucher. The number is the type's running series with a MIG marker, so a
    //    back-filled voucher is never mistaken for one raised through the app, and the department
    //    is the one its dept_doc_type mapping names — the same mapping that pins its workflow.
    this.addSql(`insert into "document" (
        "id", "doc_no", "company_id", "department_id", "document_type_id", "form_template_id",
        "workflow_id", "current_step_no", "created_by", "exchange_rate", "total_amount",
        "base_total_amount", "budget_base_total_amount", "status", "submitted_at", "approved_at",
        "created_at"
      )
      select
        gen_random_uuid(),
        'JV-MIG-' || substr(v.id::text, 1, 8),
        v.company_id,
        m.department_id,
        dt.id,
        m.form_template_id,
        m.workflow_id,
        case when v.status = 'PENDING' then coalesce(first_step.step_no, 1) else 0 end,
        v.created_by,
        1,
        t.total,
        t.total,
        t.total,
        case v.status
          when 'PENDING' then 'SUBMITTED'
          when 'APPROVED' then 'COMPLETED'
          when 'REJECTED' then 'REJECTED'
          else 'CANCELLED'
        end,
        v.created_at,
        case when v.status = 'APPROVED' then v.decided_at end,
        v.created_at
      from "journal_voucher" v
      join "document_type" dt
        on dt.company_id = v.company_id and dt.post_action = 'POST_JOURNAL' and dt.is_active
      join "dept_doc_type" m on m.document_type_id = dt.id and m.is_active
      cross join lateral (
        select coalesce(sum(l.debit), 0) as total
        from "journal_voucher_line" l where l.voucher_id = v.id
      ) t
      left join lateral (
        select s.step_no from "workflow_step" s
        where s.workflow_id = m.workflow_id
          and (s.amount_min is null or t.total >= s.amount_min)
          and (s.amount_max is null or t.total <= s.amount_max)
        order by s.step_no limit 1
      ) first_step on true
      where v.document_id is null;`);

    // The insert above can only produce one document per voucher when the type has exactly one
    // active dept_doc_type mapping; with several it would produce several. Link the earliest and
    // delete the rest, so the unique key below holds and no orphan documents are left behind.
    this.addSql(`update "journal_voucher" v
      set "document_id" = d.id
      from (
        select distinct on (substr(doc_no, 8)) id, substr(doc_no, 8) as tag
        from "document" where doc_no like 'JV-MIG-%'
        order by substr(doc_no, 8), created_at, id
      ) d
      where v.document_id is null and substr(v.id::text, 1, 8) = d.tag;`);
    this.addSql(`delete from "document" d
      where d.doc_no like 'JV-MIG-%'
        and not exists (select 1 from "journal_voucher" v where v.document_id = d.id);`);

    // 2. Decisions already made become approval-log rows: one APPROVE or REJECT by the person who
    //    decided, at the moment they decided. A withdrawal writes none, the same as cancelling a
    //    document today.
    this.addSql(`insert into "approval_log" ("id", "document_id", "step_no", "approver_id", "action", "remark", "acted_at")
      select gen_random_uuid(), v.document_id, 1, v.decided_by,
             case v.status when 'APPROVED' then 'APPROVE' else 'REJECT' end,
             v.reject_reason, v.decided_at
      from "journal_voucher" v
      where v.status in ('APPROVED', 'REJECTED')
        and v.decided_by is not null
        and v.document_id is not null;`);

    // 3. Every voucher now has one.
    this.addSql(`alter table "journal_voucher" alter column "document_id" set not null;`);
    this.addSql(
      `alter table "journal_voucher" add constraint "journal_voucher_document_id_unique" unique ("document_id");`,
    );

    // 4. What the document owns now.
    this.addSql(`drop index if exists "journal_voucher_company_id_status_index";`);
    this.addSql(`alter table "journal_voucher"
      drop column "status",
      drop column "created_by",
      drop column "decided_by",
      drop column "decided_at",
      drop column "reject_reason";`);
  }

  /**
   * Restores the columns and the state it can read back from the documents, then unlinks.
   *
   * The documents themselves STAY. Deleting them would delete the `approval_log` rows that hang off
   * them, and that log is append-only because the history is the product (invariant 2) — destroying
   * an audit trail to undo a schema change is not a rollback, it is a loss. They are inert without
   * the link: a document whose voucher no longer points at it posts nothing.
   */
  override async down(): Promise<void> {
    this.addSql(`alter table "journal_voucher"
      add column "status" varchar(255) not null default 'PENDING',
      add column "created_by" uuid null,
      add column "decided_by" uuid null,
      add column "decided_at" timestamptz null,
      add column "reject_reason" text null;`);
    this.addSql(`update "journal_voucher" v set
        "status" = case d.status
          when 'COMPLETED' then 'APPROVED'
          when 'APPROVED' then 'APPROVED'
          when 'REJECTED' then 'REJECTED'
          when 'CANCELLED' then 'WITHDRAWN'
          else 'PENDING'
        end,
        "created_by" = d.created_by
      from "document" d where d.id = v.document_id;`);
    this.addSql(`alter table "journal_voucher" alter column "created_by" set not null;`);
    this.addSql(
      `create index "journal_voucher_company_id_status_index" on "journal_voucher" ("company_id", "status");`,
    );
    this.addSql(`alter table "journal_voucher" drop constraint if exists "journal_voucher_document_id_unique";`);
    this.addSql(`alter table "journal_voucher" drop constraint if exists "journal_voucher_document_id_foreign";`);
    this.addSql(`alter table "journal_voucher" drop column "document_id";`);
  }
}
