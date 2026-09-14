## Why

A document line's expense account is decided by configuration and frozen at submit: an
item-backed line takes `item_company.default_gl_account`, which since `an item names one budget,
not the account behind it` is itself stamped from the budget the item is bound to. So every item
bound to budget `6.101` posts to `6.101`'s one account, and a budget the plan genuinely spends across
several accounts — `1.3 ຄ່າງວດລົດ` is principal and interest; a server budget is rental, licence
and bandwidth — reaches the ledger on a single account, or on none when the budget records no
`gl_account` at all. The ledger already supports one budget debiting several accounts
(`expenseByAccount`, since `debit-the-account-the-line-named`). What is missing is any person who
can say which line goes where: the requester does not know the chart, and once the document has left
DRAFT nobody can touch a line.

At HAL Logistic the last step of every disbursement route is accounting (`ບັນຊີ` / `ຫົວໜ້າບັນຊີ`).
That step sees every line, knows the chart, and today can only approve what it was handed or send
the whole document back to a requester who cannot fix the account either. This change lets that
step re-code the account each line posts to — the document's line, never the item, the budget or
the chart — in the same shape `requires_payment_slip` gave finance's step a slip, and
`RESTATE_RATE` gave finance a mid-route correction of the rate.

## What Changes

- A workflow step gains `allows_account_recode` (boolean, NOT NULL, default false), copied onto the
  recorded route (`document_approval_step.allows_account_recode`) at submit like every other step
  field, and read from the route — so turning it on reaches documents submitted afterwards and never
  changes the terms a document already in approval was submitted under. While a document sits on a
  route step carrying the flag, an approver eligible for that step who holds a new permission code
  `DOC_LINE_RECODE` may change one line's `document_line.account_id` (and its display `gl_account`,
  kept in step) to another active, postable account of the active company.
- A recode writes an `approval_log` row with a new action `RECODE_ACCOUNT` — the line, the account
  before and after — in the same append-only trail as `RESTATE_RATE` (invariant 2). The row is
  written in the same transaction as the line, under the document's lock.
- A recode changes only `account_id` / `gl_account`. It SHALL NOT touch `budget_id`, any amount, any
  basis, or any `budget_txn` (invariants 3–4): the money still comes out of the same budget, only the
  account it is expensed to moves. Master data — `item_company.default_gl_account`,
  `budget.account_id`, `budget.gl_account`, `account` — is never written.
- A recode is refused unless the document is `IN_APPROVAL`, on a step that allows it, and no
  `journal_entry` has yet been written for it — an entry already posted is corrected through a
  reversing voucher, never by moving the line under it. REJECT, RETURN, APPROVE are unaffected.
- **Posting reads the settling document's lines first.** `expenseByAccount` keys the expense side
  off the lines of the document that holds the `budget_txn` ACTUAL rows — on a PR → PO → DISB chain
  that is the PR, so a recode made at the disbursement's accounting step would never reach the
  ledger. The expense side now takes, per `line_no`, the account stamped on the document being
  posted and falls back to the charged ancestor's line only where the posted document's line carries
  none — the same "own line first, ancestor second" rule `stockPortionByAccount` already applies, so
  the two sides of a GRNI split agree by construction.
- The workflow-step editor offers the flag as a toggle beside the payment-evidence one, and says
  when the configured approver holds no `DOC_LINE_RECODE` and so could never use it — shown, not
  refused, following the slip precedent.
- The document detail (where the approver acts) lets an eligible approver re-code a line's account
  in place from an account picker limited to postable accounts of the active company; the approval
  history renders the `RECODE_ACCOUNT` row in the approver's terms.
- `DOC_LINE_RECODE` joins the declared permission catalog so `permissions:sync` creates its row and
  the startup check reports it if absent.
- Housekeeping the data model owes: `requires_payment_slip` exists on `workflow_step` and
  `document_approval_step` in the entities, the migration and the live database but in neither table
  of `erp_approval_system.dbml`; the DBML gains both flags on both tables in one edit, and
  `approve_action` gains `RECODE_ACCOUNT` beside `RESTATE_RATE`.

Explicitly out of scope: letting a requester pick an account at DRAFT; changing how an item or a
budget resolves its default account; re-coding a line after its entry is posted (that is a reversal,
already specified); moving a line to a different budget (that is a return to DRAFT and a fresh
route, already specified).

## Capabilities

### New Capabilities

None. Every behaviour here extends a capability that already exists.

### Modified Capabilities

- `approval-workflow`: a step may allow its approver to re-code line accounts; the action exists,
  is gated on `DOC_LINE_RECODE` (a new declared code, reconciled by the existing catalog rules in
  `rbac`), is attributed in `approval_log`, and step configuration mutations carry the flag.
- `document-engine`: the stamped line account is "fixed at submit and never re-derived" — narrowed
  to "never re-derived from configuration; restated only by a person, only while an approval
  remains, only before an entry is posted", the same narrowing invariant 6 received for the rate.
- `gl-journal`: the expense side of a settlement or an accrual takes each line's account from the
  document being posted before falling back to the charged ancestor's line.
- `web-doc-config`: the step editor offers the flag and says when the approver could not use it.
- `web-approvals`: the approval surface lets an eligible approver re-code a line's account before
  acting, and shows the re-code in the history.

## Impact

**Schema** — `workflow_step.allows_account_recode` and `document_approval_step.allows_account_recode`
(boolean, NOT NULL, default false); `approval_log_action_check` widened to admit `RECODE_ACCOUNT`
(same shape as `Migration20260906100000`). One migration, no backfill; every existing row stays
valid. The DBML gains `requires_payment_slip` and `allows_account_recode` on both tables,
`RECODE_ACCOUNT` on `approve_action`, and a note on `document_line.account_id` saying a person may
restate it. The
database is live: 50 documents, 6 in approval, 6 journal entries (all `PAYMENT`), 40 lines of which 1
carries a stamp today.

**Backend** — `approval.entities.ts` (`WorkflowStep`, `DocumentApprovalStep`),
`document-route.service.ts` (copy the flag onto the route), `common/enums` (`ApproveAction`), a new
`DocumentLineRecodeService` in `modules/document` shaped like `DocumentRateService` (assert, lock,
write line + log in one transaction), one endpoint on the document controller, `document/permissions`
and `seed-data` (the catalog), `gl-posting.service.ts` (`expenseByAccount` own-line-first),
`workflow-config.service.ts` and its step DTO, `erp_approval_system.dbml`.

**Frontend** — `WorkflowStepCreateView.vue` + its Zod schema + `WorkflowDetailView.vue`,
`DocumentDetailView.vue` (line action + history label), `api/documents.ts` / `api/docConfig.ts`,
the shared schema package for the DTO, i18n for `la`, `en`, `zh`.

**Invariants** — `approval_log` stays append-only: the recode is refused before its row is written,
never compensated after. `budget_txn` is untouched by every path here; the budget balance and the
outstanding reserve do not move (invariants 3–4). Company scoping: the target account is resolved
inside the active company only, and a step of another company's workflow is not-found (invariant 1).
Authorization is on `DOC_LINE_RECODE` plus step eligibility, never on a role name (invariant 5). The
stamp is still never re-derived from configuration; only a person moves it, attributed. Invariant 7:
which step may re-code is configuration on the step, read from the route the document is on.
Invariant 8 is unaffected — a recode is not an approval and grants nothing.

**Concurrency** — the recode takes the document's `PESSIMISTIC_WRITE` lock, so it cannot interleave
with the last approval landing (which would post the entry it must precede) or with a concurrent
recode of the same line. Needs a test that a recode racing the final APPROVE either lands before the
entry is written or is refused, with no in-between; and that two recodes of one line serialise to
two log rows in order.
