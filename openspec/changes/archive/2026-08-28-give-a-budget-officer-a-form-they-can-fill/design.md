## Context

The budget create form collects four things: a fiscal year, a department, the `budget_node` the
money sits at, and an amount. Three of those need a list from the server, and each list is
authorized by whoever happens to own the endpoint it came from rather than by the act the form
performs:

| picker | endpoint | required |
| --- | --- | --- |
| fiscal year | `GET /fiscal-years` | `FISCAL_YEAR_MANAGE` |
| department | `GET /departments` | `DEPARTMENT_VIEW` |
| plan node | `GET /budgets/nodes` | `DOC_CREATE` |
| GL account | selectable accounts | `COA_VIEW` |

`LATTANAPHONE` holds `BUDGET_MANAGE`, `BUDGET_VIEW`, `COA_VIEW`, `DOC_APPROVE`, `DOC_BACKDATE`,
`DOC_CANCEL`, `DOC_CREATE`, `DOC_RECEIVE`, `DOC_SUBMIT`, `DOC_VIEW`, `MASTER_VIEW`,
`NOTIFICATION_VIEW`, `QUOTA_VIEW`, `REPORT_VIEW` — and neither of the first two.

`PermissionsGuard` is `required.every((code) => granted.has(code))` with no bypass, and grants come
only from `role_permission` of the user's active-company roles. So both reads answer 403 for the
one person the screen is for.

The form makes it worse than an empty dropdown. Its `onMounted` has no `try`/`catch`, so the
rejected `Promise.all` abandons everything after it — the node read never runs and `initialValues`
is never assigned. The user sees a form with empty required pickers and no message.

`BudgetService.listFilterDepartments` already solved the identical question for the budget LIST's
department filter and wrote down why. The create form is the same trap on the screen next door.

## Goals / Non-Goals

**Goals:**

- The permission that authorizes proposing a budget is enough to fill in the form that proposes one.
- A user is not offered an affordance whose request their permissions will refuse.
- A screen that cannot load what it needs says so.

**Non-Goals:**

- Granting `LATTANAPHONE` more permissions. Handing a budget officer `DEPARTMENT_VIEW` and
  `FISCAL_YEAR_MANAGE` would make the symptom go away and leave the coupling — the next budget
  officer, at the next company, meets it again. Role membership is the customer's to decide; what
  the screen requires is ours.
- Changing what `GET /fiscal-years` or `GET /departments` require. Those are the organisation
  directory's own gates and belong to `multi-company`.
- Letting a budget officer create a fiscal year or a department. That is organisation
  administration, and the answer to "the button 403s" is to stop offering the button.

## Decisions

### The reads move to `budget-control`, gated by the act they serve

Two new reads on the budget controller, both `BUDGET_MANAGE`, both scoped to the active company:
the fiscal years a budget may be proposed for, and the departments it may be proposed for. Each
returns identifying fields only — no figures — the way `listSelectable` and `listFilterDepartments`
already do.

*Alternative considered — loosen the gate on the organisation directory.* Rejected: it changes who
can read every department and fiscal year in the company in order to fix one form, and it decides a
`multi-company` question from inside a budget change.

*Alternative considered — accept either `BUDGET_MANAGE` or `DEPARTMENT_VIEW` on the existing route.*
Not expressible. `@RequirePermissions(...)` is AND — `required.every(...)` — so a route cannot
declare an alternative without changing the guard for everything that uses it.

### The department read offers every active department, not only the budgeted ones

`GET /budgets/filter-departments` exists and is nearly right, but it deliberately returns only
departments that already HOLD a budget — correct for a filter, which must never offer an option
that yields nothing. A create form needs the opposite: a department's FIRST budget is the one this
screen exists to propose, and sourcing the picker there would make an unbudgeted department
unbudgetable through the UI.

So this is a second read rather than a reuse, and the two differ on purpose.

### An affordance is offered only when its own request would be allowed

"New fiscal year" needs `FISCAL_YEAR_MANAGE` and "New department" needs `DEPARTMENT_MANAGE` — the
permissions their POSTs already require. Each button is gated on the permission its own request
needs, so nobody is invited into a 403. The "New plan node" button stays as it is: `POST
/budgets/nodes` requires `BUDGET_MANAGE`, which whoever is on this form already holds.

This is the client mirror the frontend conventions ask for, applied to a control that was gated on
nothing.

### A failed load is a state the screen has, not an exception it drops

The load is wrapped, and a failure renders the error state the other budget screens already use
rather than an empty form. The 403 is the case in hand; a dropped connection produces the same
uninterpretable form today.

## Sequence: what writes `budget_txn`

Nothing here writes `budget_txn` or `quota_usage`, and nothing here writes any row at all. Both
additions are SELECTs, and the remaining changes are a permission-gated button and an error branch.
There is therefore no transaction boundary and no lock to specify: no unit of work is created,
extended, or reordered by this change. Proposing a budget still writes the budget and its plan in
the one `em.transactional(...)` that `BudgetPlanService.propose` already owns, untouched here.

## Risks / Trade-offs

- **[Two more reads on the budget controller]** → more surface authorized by `BUDGET_MANAGE`.
  Mitigation: both are identifying fields only and company-scoped, so neither can leak a figure or
  another company's row; and both answer strictly less than the directory endpoints they replace,
  which return the whole record.

- **[The same coupling survives on the plan-node read]** → `GET /budgets/nodes` still requires
  `DOC_CREATE`, so a budget officer who raises no documents would still meet an empty node picker.
  Mitigation: named in the proposal as out of scope with the reason — the guard is AND-only, so
  fixing it means deciding whether `PermissionsGuard` should support alternatives, which deserves
  its own change rather than a quiet widening here.

- **[Hiding the inline-create buttons removes something admin currently uses]** → an administrator
  holds both permissions and keeps both buttons, so nothing is taken from the user who had them.

## Migration Plan

No schema change and no data change. Backend and frontend deploy together — the client's new reads
need the new routes. Rollback is a revert; the reverted client goes back to the directory reads.

No permission is created, deleted or re-assigned, so no role needs re-granting and nobody's access
changes except that a `BUDGET_MANAGE` holder can now fill in the form.

## Open Questions

None.
