## Why

`LATTANAPHONE` is the budget officer. They hold `BUDGET_MANAGE`, the budgets list offers them
"New budget", the route guard lets them through — and the form they land on cannot be filled.

It reads its two required pickers from the organisation directory:

```
const [fy, dept] = await Promise.all([
  orgApi.fiscalYears.list(1, 100),   // GET /fiscal-years   → FISCAL_YEAR_MANAGE
  orgApi.departments.list(1, 100),   // GET /departments    → DEPARTMENT_VIEW
  accounts.loadSelectable(),
]);
```

They hold neither. Both answer 403, and because that `Promise.all` sits in an `onMounted` with no
`catch`, the rejection stops everything after it: the plan-node picker never loads and
`initialValues` is never set. The form is dead, and says nothing — the only trace is an unhandled
rejection in the console.

Two users in this company hold `BUDGET_MANAGE`: `admin`, who also holds every organisation
permission and so never sees this, and `LATTANAPHONE`, who is the person the screen exists for.

This codebase has already decided this question once, one screen over. `BudgetService`
`listFilterDepartments` carries the reasoning: *"Gated with the budget list itself (`BUDGET_VIEW`),
NOT with the department directory. That directory needs `DEPARTMENT_VIEW`, which a holder of
`BUDGET_VIEW` need not have — so sourcing this dropdown there would present an empty filter to
exactly the department heads it exists to serve."* The list filter was fixed that way. The create
form was not.

## What Changes

- Proposing a budget SHALL need only the permission that proposes budgets. The form's fiscal-year
  and department pickers come from budget-scoped reads gated on `BUDGET_MANAGE`, not from the
  organisation directory.
- The department read offers every active department of the active company, not only those that
  already hold a budget. A department's first budget is the one this form exists to propose, and
  the existing `filter-departments` read would hide exactly that case.
- The form's inline "New fiscal year" and "New department" buttons are offered only to a user who
  holds the organisation permission each one needs. Creating a fiscal year is not budget work, and
  a button that answers 403 is worse than no button.
- A form that cannot load what it needs SHALL say so. Silently rendering an unusable form is how
  this went unnoticed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `budget-control`: gains a requirement that the reads a budget proposal needs are authorized by
  the permission that authorizes proposing, so proposing never depends on organisation
  administration.
- `web-budgets`: "Budget Create and Edit" sources its pickers from those reads, offers an
  organisation-creating affordance only to a holder of that organisation permission, and reports a
  failed load instead of rendering a dead form.

## Impact

- **Capabilities touched**: `budget-control` (two reads), `web-budgets` (the create form). `rbac` is
  read from, not changed — no permission code is added, removed or re-assigned.
- **Invariant risk**: INVARIANT 1 (company isolation) is the one to watch. Both new reads must be
  scoped to the active company like every other budget read; a department or fiscal year of another
  company must not be offered. INVARIANT 5 (permission codes, not role names) is what the change is
  *about*: the fix is to authorize the read by the code that matches the act, never by widening
  anyone's role.
- **Ledger**: nothing here writes `budget_txn` or any other row. These are reads, plus a
  permission-gated affordance and an error path.
- **Code**: `BudgetService` (two selectable reads), `BudgetController` (two routes), the budgets
  API client, and `BudgetFormView`'s load, its two inline-create dialogs, and its failure state.
- **Not in scope**: the plan-node read, `GET /budgets/nodes`, is gated on `DOC_CREATE`. That is the
  same coupling one step removed — a budget officer who did not also raise documents could not read
  the node list either — but `LATTANAPHONE` holds `DOC_CREATE`, so it is not what breaks the form
  today. `PermissionsGuard` requires *every* declared code (`required.every`), so "either
  `DOC_CREATE` or `BUDGET_MANAGE`" cannot be expressed without changing the guard. Worth its own
  change, with that guard question decided deliberately rather than in passing.
- **Not in scope**: the gate on `GET /fiscal-years` itself. Requiring `FISCAL_YEAR_MANAGE` to *read*
  fiscal years is questionable — the permission catalog has no `FISCAL_YEAR_VIEW` at all — but
  loosening it would change who can read the organisation directory, which is a decision about
  `multi-company`, not about proposing a budget.
