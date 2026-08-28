## Why

`BUDGET_PLAN-HAL-2026-0001` was approved for 12,000,000 LAK by a person whose screen never named
the budget it activates. The document detail page reads "ບໍ່ມີລາຍການ" — no lines — and the approval
dialog shows an amount and a type and nothing else. The content is there: `budget_movement` holds
`ACTIVATE_BUDGET → budget 1.106 → 12,000,000` against that document id. Nothing reads it.

Three types are affected today — `BUDGET_PLAN`, `BUDGET_ADJ_INC`, `BUDGET_ADJ_DEC` — and any type
whose `post_action` is a budget movement, a transfer, or a journal posting. Their content lives
outside `document_line` by design, and `document-engine` already has a requirement for the writing
half of that split: "A Document Type Declares Where Its Content Is Authored" sends the requester to
the screen that can author it. There is no matching requirement for reading it back, so the
authoring problem was solved and the reading problem was not noticed.

The link is legible in one direction only. From a budget, its ledger names every document that moved
it. From a document, nothing names the budget.

Every movement of money in this system is deliberately forced through a document and an approval.
That control is worth only as much as the approver can see.

## What Changes

- The document detail read returns the `budget_movement` rows belonging to the document — what kind
  of movement, which budget (code, name, department), and how much.
- The document screen shows that where it shows lines today, so a movement document states what it
  does instead of reading as empty.
- The approval dialog shows the same, because that is the screen where the decision is actually
  made. An approver SHALL see which budget an amount lands on before signing.
- A movement's budget links to that budget's page, so the reader can check the balance the movement
  is about to change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: gains a requirement that content held outside `document_line` is readable
  through the document, mirroring the existing requirement about where it is authored.
- `web-documents`: "Document List and Detail" shows a document's budget movements, and the
  approval affordance shows them before the decision.

## Impact

- **Capabilities touched**: `document-engine` (read model), `web-documents` (detail + approval).
  `budget-control` is read from, not changed — `budget_movement` already carries everything needed.
- **Invariant risk**: none introduced. This is a read; it writes nothing and changes no balance.
  It reduces a different risk — INVARIANT 8 gives the approval its authority, and an approver who
  cannot see the target is approving in name only.
- **Company scope (INVARIANT 1)**: the movement read must be scoped like every other document read.
  A movement names a budget, and a budget of another company must not be resolvable through it.
- **Code**: the detail read in `document.service.ts` (its payload has `document`, `fieldValues`,
  `lines`, `attachments`, `refDocument`, `hasPayment` and nothing else), the document detail view,
  and the approve dialog in the approvals view.
- **Not in scope**: journal vouchers. `POST_JOURNAL` has the same shape — content on
  `journal_voucher` rather than `document_line` — and the same blindness, but no such type is
  configured for this company yet. Worth the same treatment when one is.
