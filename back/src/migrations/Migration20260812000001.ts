import { Migration } from '@mikro-orm/migrations';

/**
 * Give every company that already routes budget documents a `BUDGET_PLAN` document type.
 *
 * Without one, `BudgetService.create` still drafts a budget but no plan can be raised for it, so
 * nothing can ever reach ACTIVE: the company cannot set a budget at all. That is a harder failure
 * than the one the other budget types have. Never configuring `BUDGET_TRANSFER` only costs you
 * transfers; never configuring `BUDGET_PLAN` costs you the module. A type this load-bearing cannot
 * be left to be noticed after the upgrade.
 *
 * The routing is BORROWED, not invented. A migration cannot decide who should approve a budget —
 * that is the company's decision, expressed as a `workflow` — so it copies the routing of the
 * budget document type the company already approves: whoever signs off an adjustment to a budget
 * signs off setting one. Concretely, for each company it picks a donor type by `post_action`
 * (TRANSFER first, then ADJUST_INCREASE, then ADJUST_DECREASE — a fixed order so two runs on two
 * replicas agree), and mirrors that donor's `dept_doc_type` rows onto the new type.
 *
 * A company with no budget document type at all is skipped. There is nothing to borrow, and
 * guessing a workflow would put a budget in front of approvers nobody chose. Those companies
 * configure the type through the admin screens, as they would any other.
 *
 * Idempotent: every insert is guarded by a NOT EXISTS on the row it would create.
 */
export class Migration20260812000001 extends Migration {
  override async up(): Promise<void> {
    // The donor per company: the budget document type whose routing the plan will copy.
    const donor = `
      select distinct on (dt.company_id)
             dt.company_id, dt.id as donor_type_id, dt.category
        from document_type dt
       where dt.post_action in ('TRANSFER', 'ADJUST_INCREASE', 'ADJUST_DECREASE')
       order by dt.company_id,
                case dt.post_action
                  when 'TRANSFER' then 1
                  when 'ADJUST_INCREASE' then 2
                  else 3
                end`;

    // 1. The type itself. `code` is unique per company, so a company that already has a
    //    BUDGET_PLAN code (configured by hand before upgrading) is left exactly as it is.
    this.addSql(`
      insert into "document_type" (
        "id", "company_id", "code", "name", "category",
        "requires_budget", "requires_quota", "requires_vendor", "requires_item",
        "requires_payee", "requires_warehouse", "derives_quantity", "accrues_on_approval",
        "post_action", "is_active")
      select gen_random_uuid(), d.company_id, 'BUDGET_PLAN', 'Budget Plan', d.category,
             false, false, false, false,
             false, false, false, false,
             'ACTIVATE_BUDGET', true
        from (${donor}) d
       where not exists (
         select 1 from document_type x
          where x.company_id = d.company_id
            and (x.code = 'BUDGET_PLAN' or x.post_action = 'ACTIVATE_BUDGET'));`);

    // 2. A published template with no fields. A plan's content lives on `budget_movement`, like
    //    the adjustment and transfer documents — the generic form has nothing to collect.
    this.addSql(`
      insert into "form_template" ("id", "document_type_id", "version", "status", "created_at")
      select gen_random_uuid(), dt.id, 1, 'PUBLISHED', now()
        from document_type dt
       where dt.post_action = 'ACTIVATE_BUDGET'
         and not exists (select 1 from form_template ft where ft.document_type_id = dt.id);`);

    // 3. The routing, mirrored from the donor: same departments, same workflow, this type's own
    //    template. A department that could raise a budget adjustment can now raise a budget plan.
    this.addSql(`
      insert into "dept_doc_type" (
        "id", "department_id", "document_type_id", "form_template_id", "workflow_id", "is_active")
      select gen_random_uuid(), src.department_id, plan.id, ft.id, src.workflow_id, true
        from (${donor}) d
        join document_type plan
          on plan.company_id = d.company_id and plan.post_action = 'ACTIVATE_BUDGET'
        join form_template ft on ft.document_type_id = plan.id
        join dept_doc_type src on src.document_type_id = d.donor_type_id and src.is_active
       where not exists (
         select 1 from dept_doc_type x
          where x.department_id = src.department_id and x.document_type_id = plan.id);`);
  }

  override async down(): Promise<void> {
    // Only what this migration could have created. A company that configured its own plan type
    // before upgrading was skipped on the way up and must be left alone on the way down, so the
    // match is on the code this migration writes as well as the post_action.
    this.addSql(`
      delete from "dept_doc_type" where "document_type_id" in (
        select id from document_type where post_action = 'ACTIVATE_BUDGET' and code = 'BUDGET_PLAN');`);
    this.addSql(`
      delete from "form_template" where "document_type_id" in (
        select id from document_type where post_action = 'ACTIVATE_BUDGET' and code = 'BUDGET_PLAN');`);
    // Documents already raised against the type hold it by FK; the delete fails rather than
    // orphaning an approval that happened. Reversing this migration after a plan has been raised
    // is not a reversal — the approval is a fact.
    this.addSql(`
      delete from "document_type" where post_action = 'ACTIVATE_BUDGET' and code = 'BUDGET_PLAN';`);
  }
}
