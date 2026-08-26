## 1. The budget list learns two filters

- [ ] 1.1 `BudgetListQueryDto extends SearchablePaginationQueryDto` — optional `departmentId`
      (UUID) and `status` (one of `DRAFT | ACTIVE | REJECTED | CLOSED`), both validated. An invalid
      status is a 400, never a silently ignored parameter.
- [ ] 1.2 `BudgetService.list` — `$and` each given filter onto the already-scoped `where`, beside
      `withSearch`. Neither may replace the scope; neither has a default.
- [ ] 1.3 `budget.controller.ts` — widen the list endpoint's query DTO. No permission change.
- [ ] 1.4 DB-backed spec: a department filter narrows and `total` follows; a status filter sets the
      REJECTED rows aside; no status filter returns every status.
- [ ] 1.5 DB-backed spec: filters compose with each other and with `search`, as a conjunction.
- [ ] 1.6 DB-backed spec: a department id from another company returns nothing and counts nothing —
      the case that would make a filter a way out of company scope (invariant 1).

## 2. The options a budget reader can actually read

- [ ] 2.1 `BudgetService.listFilterDepartments()` — the departments holding at least one budget in
      the active company, `{ id, deptCode, name }` only, ordered by name. No amounts: a filter's
      option list has no business carrying figures.
- [ ] 2.2 Endpoint on `budget.controller.ts` gated by `BUDGET_VIEW`, **not** `DEPARTMENT_VIEW` —
      a department head reading budgets need not hold the directory permission, and sourcing the
      dropdown from `GET /departments` would hand them an empty filter.
- [ ] 2.3 DB-backed spec: a department with no budget is absent; another company's department is
      absent; the response carries no amount field.
- [ ] 2.4 Spec: the endpoint answers a caller holding `BUDGET_VIEW` alone.

## 3. The budget screen

- [ ] 3.1 `api/budgets.ts` + `stores/budgets.ts` — carry `departmentId` and `status` in store state
      beside `search`, so paging keeps them; each setter resets to page 1.
- [ ] 3.2 `BudgetListView.vue` — a `#filters` slot on `PageToolbar` with two `Select`s, both
      `showClear`, labelled from i18n and styled with theme tokens only.
- [ ] 3.3 Status options come from the four declared statuses, not from what the data happens to
      hold — so `CLOSED` is there the first time a year closes.
- [ ] 3.4 Load the department options once per company context, not per keystroke or per page.
- [ ] 3.5 The filters are hidden in tree mode, as the search box already is: the tree is fed by its
      own full load and these do not narrow it.

## 4. The control points screen

- [ ] 4.1 `ControlPointListView.vue` — the same two controls, filtering on the client, because the
      screen already holds all 474 rows (`clientPaged`). Its dimensions are the department NODE and
      `isActive`.
- [ ] 4.2 Options derived from the loaded rows — correct here precisely because the client holds
      every row, which is the same reason its search filters client-side.
- [ ] 4.3 Component spec: each control narrows across every loaded row, not the visible page.

## 5. Say what is being hidden

- [ ] 5.1 A shared way to state "showing N of M" whenever any filter or term is active, used by
      both screens. Absent when nothing is set — a count beside an unfiltered list is noise.
- [ ] 5.2 The empty state distinguishes "your filters excluded everything" from "there are no
      budgets", and offers to clear them.
- [ ] 5.3 Component spec for both: the count appears only when something is set, and reads the
      narrowed total against the unnarrowed one.

## 6. Close the loop

- [ ] 6.1 `pnpm --filter back test` and `pnpm --filter front-end run ci`.
- [ ] 6.2 Walk both screens: filter to ການຕະຫຼາດ and confirm 59; filter to REJECTED and confirm 18;
      combine a filter with a term; clear each and confirm the list returns.
- [ ] 6.3 Confirm a `BUDGET_VIEW`-only account sees populated department options — the permission
      trap this change exists to avoid, and the one thing a developer account cannot demonstrate.
- [ ] 6.4 Fold the deltas into `openspec/specs/budget-control/spec.md` and
      `openspec/specs/web-ui-quality/spec.md`.
