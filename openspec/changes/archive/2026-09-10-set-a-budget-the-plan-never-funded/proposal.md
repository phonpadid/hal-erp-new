## Why

A line the plan never funded but the company keeps spending on has no way to exist in the web app.
The 2026 expenditure plan holds 92 such lines — 28,059,942,137 LAK already spent against codes whose
`ງົບປະມານ/ປີ2026` cell is empty — and a budget officer cannot enter a single one of them, because
the two settings that make such a line work are both unreachable from the screens they own:

- The budget form refuses `0`. The only honest figure for an unfunded line is zero, and `0` is what
  the plan importer already writes for the section the workbook itself marks `ບໍ່ມີງົບ`. The server
  accepts it; the client's Zod resolver demands a positive number, so the form the officer was given
  cannot express what their own plan says.
- The tolerance ladder is read-only. A zero-ceiling line governed by `BLOCK at 100` refuses every
  request, including the backdated entry that records what was already paid. Recording that history
  and continuing to spend needs `WARN at 100`, and the control-point screens show the ladder without
  offering to change it — while `PATCH /budgets/control-points/:id` has accepted a new ladder all
  along.

The result is a screen pair that can display the problem and not fix it, and an officer who must ask
an engineer to run an API call for work that is plainly theirs.

## What Changes

- The budget form accepts `0` as `amount_total` when proposing. Empty, negative and non-numeric stay
  refused, and `amount_total` remains uneditable after creation — corrections are still ledger
  adjustments, never an overwrite.
- The form says what a zero budget means, at the moment it is entered: the line is recorded with no
  money, spending against it will be refused until the ladder governing it allows an overrun.
- The control point detail screen lets a `BUDGET_MANAGE` holder edit the tolerance ladder — add,
  remove and change rungs — and save it. `BUDGET_VIEW` continues to see the ladder read-only.
- The ladder editor states the consequence of each action in the reader's language: `BLOCK` refuses
  at the threshold, `WARN` allows the overrun and records a warning. A ladder that would refuse
  every request — `BLOCK` at or below a zero ceiling — is shown as such before it is saved, not
  discovered by a refused document later.
- The control point list offers the same edit affordance per row for a `BUDGET_MANAGE` holder, so a
  fiscal year's ladders can be set without opening each point.

**No backend change.** `POST /budgets/propose` already accepts `"0"`, `PATCH
/budgets/control-points/:id` already accepts a ladder, and both are already gated on
`BUDGET_MANAGE`. This change removes client-side refusals of requests the server would honour.

## Capabilities

### New Capabilities

None. Both screens exist; what they refuse is the change.

### Modified Capabilities

- `web-budgets`: the budget form's amount validation admits zero; the control point detail and list
  gain a permission-gated tolerance-ladder editor.

## Impact

- `shared/src/index.ts` — `budgetCreateSchema.amountTotal` moves from "a positive amount" to "zero
  or more". `budgetTransferSchema` and the adjustment schema keep their positive rule: a transfer or
  adjustment of nothing is a different thing from a budget of nothing.
- `front-end/src/views/budgets/BudgetFormView.vue` — the zero-amount notice.
- `front-end/src/views/budgets/ControlPointDetailView.vue`, `ControlPointListView.vue` — the ladder
  editor and its affordance gating.
- `front-end/src/api/budgets.ts`, `front-end/src/stores/budgets.ts` — the update call and its state.
- i18n en/la/zh parity for every new label, including the `A positive amount` message that currently
  renders untranslated.
- No migration, no entity, no DTO, no endpoint.

### Invariants

Nothing here touches an invariant. `amount_total` stays write-once (derived balances), the ladder
lives on the control point rather than on the budget (configuration over code), and every write goes
through the same company-scoped, `BUDGET_MANAGE`-gated endpoint the server already enforces
(permission codes, company isolation). The client guard stays UX; the server stays authoritative.

### Deliberately Out of Scope

A control point's ceiling counts every budget hanging at its node, including budgets in `DRAFT` and
`REJECTED` — statuses `isCountedBudget` excludes everywhere else. A rejected budget therefore still
grants spending room. It is a server-side correctness defect, it is not what this change is about,
and folding it in would put a ledger-affecting fix behind a UI review. It belongs in its own change.
