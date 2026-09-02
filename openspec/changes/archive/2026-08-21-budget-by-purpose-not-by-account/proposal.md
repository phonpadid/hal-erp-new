## Why

A budget answers a management question — *whose money is this, and what is it for* — and the chart
of accounts answers an accounting one — *what kind of expense is this*. The system currently assumes
they are the same question: `budget` is keyed `(fiscal_year_id, department_id, gl_account)`, and a
document line finds its budget by walking `item → default_gl_account → budget`.

The customer's own books say otherwise, in both directions at once.

One account is charged by several budget lines. A single journal voucher in their accounting system
posts thirteen lines to account `658.0007` — vehicle parking, repairs, refuelling, registration,
weighing fees — which their budget sheet splits across `7.1 fuel` (48bn), `7.5 repairs` (41bn) and
`1.205 registration and road fees`, all inside the same department.

One budget line is charged to several accounts. `1.3 vehicle instalments` covers loan principal and
interest, which are a liability movement and an expense; `2.2 employee payments` (44bn) covers
salary, overtime, social security and welfare. Confirmed by their accountants.

Neither direction fits a key that contains the account. `Account A → Budget X`, `Account B → Budget
X` and `Account A → Budget Y` cannot coexist while the account is part of the budget's identity.

The two worlds are already disconnected in their practice, and the disconnection is manual: their
accounting system has no budget-code column, their budget sheet has no account column, and a person
carries the link in their head. That person is the integration this project is meant to replace.

## What Changes

- A new `budget_node` table carries the plan's structure — department → category → line, the shape
  their plan already has — with the `code` their organisation speaks in (`1.101`, written by hand on
  5,714 of 5,738 spend rows today) and a `parent_id`. A budget references one node. **A node is not
  a budget:** a category has no amount, is charged by nothing, and is approved by nobody on its own.
- `gl_account` leaves the budget's identity. **BREAKING** for the unique key
  `(fiscal_year_id, department_id, gl_account)`; identity becomes the node, unique per
  `(fiscal_year_id, department_id, code)`.
- A document line carries its GL account and its budget as **two independent dimensions**: the
  account still derives from the item, and the budget is chosen by the requester — which is what
  they already do on every spend row. Choosing a budget SHALL no longer overwrite the line's
  `gl_account`.
- Budget control points move from the account tree to the node tree. The mechanism is unchanged —
  a point may sit at any node, a budget must pass **every** point that covers it, and the tolerance
  ladder still decides WARN vs BLOCK. Only which tree is walked changes.
- **No account-to-budget mapping table.** The relationship is a fact of each transaction, not a rule
  declared in advance. This is the single decision that keeps the change small; see design.md.
- **REMOVED**: resolving a budget from `(gl_account, department, fiscal year)` as the primary path
  for an item-backed line. A budget that cannot be derived must be named.

## Capabilities

### New Capabilities

None. This changes the identity and the resolution path of an existing capability.

### Modified Capabilities

- `budget-control`: a new `budget_node` structure and the budget's identity; `Resolve Budget by GL,
  Department, and Fiscal Year` no longer describes how a line finds its budget; `Budget Control Point` and
  `Availability Is Checked at Governing Control Points` walk the node tree instead of the account
  tree; `Selectable Budgets for Document Creation`
  becomes the primary path rather than an item-less fallback.
- `document-engine`: `Item-Driven GL and Budget Resolution on Lines` keeps deriving the GL from the
  item and stops deriving the budget from it; `Complete Budget Coverage on Submit` now refuses a
  line that names no budget rather than one whose account resolves to none.
- `web-documents`: the line editor offers the budget picker on every budget-controlled line, not
  only on an item-less one, and shows the derived GL beside it rather than in place of it.
- `web-budgets`: budget list and detail show the node code and the tree; control-point screens
  pick a budget node rather than an account node.
- `reporting`: budget-balance and utilisation group by budget node, not by GL account.

## Impact

- **Schema**: a new `budget_node` table; `budget` gains `node_id` and loses `gl_account` from its
  identity; `budget_control_point` replaces `account_node_id` with `budget_node_id`. No table is
  dropped and no ledger table is touched.
- **Backend** `back/src/modules/budget/`: `budget-coverage.service.ts` (312 lines) walks two
  recursive CTEs, `account_up` and `department_up`; only the first is replaced by `node_up` — the
  same shape over a different `parent_id`. `budget-control-point.service.ts`, `budget.service.ts`,
  and the line-resolution path in `back/src/modules/document/`.
- **Frontend** `front-end/src/`: the line editor, budget screens, control-point screens, reports.
- **Data migration**: their 485 budget lines carry duplicate codes in at least one place (`3.1`
  appears twice with different amounts). Codes must be unique before they can be a key. This is
  the customer's data to settle, not a code question, and it blocks import rather than development.

- **This proposal was revised once during implementation.** The first version put `parent_id` on
  `budget` and made categories budget rows holding no amount. It worked, and it left five separate
  readers of the budget table having to remember that some rows there are not budgets — three were
  already getting it wrong. `design.md` carries the consumer trace that settled it. The half of the
  change this proposal exists for, that an account is not a budget's identity, never depended on
  where the tree lived and did not change.

### Invariants

- **Invariant 1 (company isolation)** is load-bearing on the new tree: coverage is scoped through
  the budget's fiscal year to the company, exactly as the account tree is today, so a control point
  can never govern another company's budget even if two companies' trees share an id.
- **Invariants 2, 3, 4, 5** are untouched. `budget_txn` stays append-only, the balance formula is
  unchanged, and reserve → actual → release acts on the resolved `budget_id` as before — only how
  that id is *chosen* changes.
- **Invariant 7 (configuration over code)** is what the control-point decision rests on: where the
  block sits is placed by an administrator, not compiled in, so the customer can start loose at
  department level and tighten to category or line without a deployment.

### What this gives up, deliberately

"How much budget does account `658.0007` have?" stops being answerable, because that account's money
is spread across several budget lines by a human decision recorded per transaction. The question
their organisation actually asks — "how much is left in `7.1 fuel`" — is the one that stays
answerable. The current spec implies the first question has an answer; that implication is withdrawn
here rather than left to be discovered.

### Out of scope

- **Monthly and quarterly budget phasing.** Their plan plans per month and measures variance per
  quarter (`1.101` ran 130% of its Q1 allocation while sitting at 32% of its annual). That is a
  second dimension — *which period's money* — orthogonal to this one — *which node's money* — and is
  better added on top of this than tangled into it.
- **Validating that a chosen budget suits the line's account.** Storing which accounts a budget
  usually pairs with, and warning when a requester picks outside them, would recover some of the
  safety this change gives up. It is worth doing and is not needed to make this work.
- **Revenue budgeting.** Their revenue targets are a measurement baseline, not a spend control, and
  do not belong in a reserve/actual/release ledger.
