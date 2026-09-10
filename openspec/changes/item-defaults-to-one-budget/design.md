## Context

`item_company` holds one per-company attribute for an item: `default_gl_account`. The item registry
screen presents it as "budget (this company)" — because that is the language an admin thinks in — and
sources its options from `GET /budgets/gl-options`, the ACTIVE budgets of the open fiscal year that
name an account. Since the column can only hold the account, budgets sharing one are indistinguishable
once saved, and the screen folds them into a single option to avoid offering four choices with one
outcome.

Two facts constrain any fix:

- **A budget is a per-year row.** `budget.fiscal_year_id` is not null, and `budget_node` is unique on
  `(fiscal_year_id, code)` — the node carries no department at all, deliberately, so that a control
  point can name a node and a department node independently. Its stable identity across years is the
  *plan* identity: the plan code the organisation actually says out loud ("6.101").
- **The account is what posts.** `document.service.resolveLineAccount` stamps a line's GL from
  `item_company.default_gl_account` and refuses a `requires_budget` line whose item has none;
  `gl-posting.service` resolves the same column to the account the journal debits.

## Goals / Non-Goals

**Goals:**

- An item's per-company default names ONE budget, and the admin sees the one they picked.
- Opening a new fiscal year does not require re-pointing every item.
- Documents and journal entries post exactly as they do today.
- Items that carry only an account keep working, unchanged and unbound.

**Non-Goals:**

- Changing how a document charges budget. A line charges the budget it names (`line.budgetId`); this
  binding is a registry default, not a second path to money. No `budget_txn` is written by anything
  in this change, so there is no ledger sequence, no transaction boundary and no lock to specify.
- Defaulting a document line's budget from its item. That is a document-engine behaviour and needs
  the department of the requester to be part of the rule; it is a separate slice.
- Back-filling a budget for the items that hold only an account.
- Retiring `default_gl_account`.

## Decisions

**1. Store the plan identity (`default_budget_code`), not `budget_id`.**

A `budget_id` is exact and would be one column with a foreign key — but it is a per-year row. On 1
January every item in the registry would point at a CLOSED budget, and the fix would be a data
migration run every year against every item. The plan code is what the organisation keeps stable
across years: `budget_node` is unique on `(fiscal_year_id, code)`, so within the open year a code
resolves to exactly one node, and `budget.node_id` is unique, so that node resolves to exactly one
budget.

The department was going to travel with the code, on the reading that codes are unique per
department. The DBML says that — `budget_node` there carries a `department_id` and a three-column
key — but the entity and the database say otherwise, and have since the node stopped carrying a
department (a control point names a node AND a department node, and a node that fixed the
department would leave half of coverage unable to tell two budgets apart). The code alone is the
key, so a second column would have been dead weight in every row. The DBML block is corrected as
part of this change rather than left to mislead the next reader the same way.

**2. Resolve to the open fiscal year at read, exactly as the picker's options are sourced.**

The same year the options come from (`FiscalYearService.resolveOpenPeriod(today)`, falling back to
`mostRecentOpen()`) is the year a binding resolves in. One rule, so a binding can never resolve
against a year the picker never offered. Company isolation rides on this: `fiscal_year` is
company-scoped, so a code is only ever looked up inside the active company's own plan.

**3. Keep `default_gl_account` and stamp it from the bound budget.**

The account remains a stored column, so `document.service`, `document-submit.service` and
`gl-posting.service` are untouched — the riskiest code in this area does not move. When a binding is
set, the resolved budget's `gl_account` is stamped onto the item; when a binding is cleared, the
stamp is left as it is (an item that posts today does not stop posting because someone cleared a
label). The alternative — deriving the account at read from the resolved budget — was rejected
because it makes every GL read depend on the open fiscal year resolving, which would turn a
year-end gap into documents that cannot be submitted.

The trade: editing a budget's `gl_account` later does not retroactively re-stamp the items bound to
it. That is the correct accounting reading — the account an item posts to is a decision recorded when
it was made — and the registry screen shows both, so a divergence is visible where it is fixed.

**4. `gl-options` is left as it is; the caller stops collapsing it.**

The endpoint already returns one row per budget (`glAccount`, `code`, `budgetName`,
`departmentName`) — the plan code on each row is exactly what names one budget, and the department
rides along as a label. Nothing needs adding; the screen was the only thing folding those rows
together. Gate unchanged (`MASTER_VIEW`), figures still absent.

**5. The client sends the code; the server validates it.**

`POST /items/:id/enable` accepts `defaultBudgetCode`. The server resolves it against the open year of
the ACTIVE company and rejects a code that resolves to no budget, or to a budget that is not
`ACTIVE`. The client never sends an account for an item any more — sending one is how it would drift
from the budget it claims to post to.

**6. The screen keeps the "still visible" rule it has for accounts.**

An item bound to a plan code the open year does not carry renders as that code, marked as outside the
open year, and stays selectable-away. It is the same rule the account picker already applies to an
account no budget names, for the same reason: a set row must never read as unset.

## Risks / Trade-offs

- **A plan code reused for something else next year** → the binding silently follows the new meaning.
  Mitigated by the screen showing the resolved budget's *name* (from the open year), not the name
  stored at bind time — so a code that now means something else is visible as the wrong name, and no
  money moves off this binding regardless.
- **Stamped account drifts from the bound budget's account** → the registry row shows the budget and
  its account together, so the drift is legible; the document engine keeps reading the stamp, so
  posting stays deterministic.
- **Two writes in one save (binding + stamp)** → both are fields of the same `item_company` row, so
  one `flush()` writes them; there is no window where an item is bound to a budget while carrying a
  different account.
- **No open fiscal year (a company mid-setup)** → the picker has no options and a binding cannot be
  set, which is the current behaviour of the account picker sourced from the same call. Items keep
  their stamped accounts and documents keep posting.

## Migration Plan

1. Additive migration: one nullable column on `item_company`. A varchar and not a foreign key,
   because the row a code names is a different row each year — there is no one row to reference. No
   back-fill — an account cannot be resolved back into one of the several budgets that share it, and
   guessing would record a binding nobody chose.
2. Ship backend and frontend together: until the client sends the pair, the columns stay null and the
   screen behaves as it does today.
3. Rollback is dropping the column; `default_gl_account` never stopped being the posting account,
   so no document or journal entry depends on the new one.
