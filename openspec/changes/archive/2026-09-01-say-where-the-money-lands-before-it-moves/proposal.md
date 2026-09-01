## Why

A budget may name no GL account — the form calls the field optional and tells the user to *"leave
it empty when spending posts to several accounts"*. The ledger disagrees: `Posting on Payment
Settlement` debits the expense side **via `budget.account_id`**, so a budget with no account cannot
be posted at all. Nothing reconciles the two. A user who follows the form's own advice strands every
payment charged to that budget.

It strands them at the worst possible moment. The budget is reserved at submit and cut to ACTUAL at
final approval; the money leaves at `Record payment`; and only *then*, on an event nobody is
watching, does the posting fail. What the accountant eventually sees is a row on **Undelivered
Postings** reading `Budget 8ad37658-9d63-4688-b923-06f71d759d57 has no account_id` — a raw UUID, no
budget code, no document number — which they cannot act on: naming a budget's account is
`BUDGET_MANAGE`, re-queueing the posting is `GL_POST_RETRY`, and the accounting role holds neither.
After five sweeps the attempt is `FAILED` and stops retrying. The spend is real, the ledger is
silent, and no screen says so.

This is not hypothetical. In the live company every one of the 7 budgets has an empty GL account, so
**no payment can reach the ledger at all** — the chart of accounts holds 4,067 accounts and not one
budget points at any of them.

## What Changes

- A document whose lines charge a budget that names no GL account **cannot be submitted**. Submit
  refuses, naming the budget by code and saying where the account is set. The refusal happens before
  any budget is reserved, so nothing has to be unwound.
- The refusal is shown the way a missing required field already is: the submitter is told which
  budget is unmapped rather than being handed a failure they cannot read.
- A posting that failed **only** for want of a GL account becomes postable again once the account is
  named — the exhausted-retry state stops being a dead end for the documents already stranded.
- The undelivered-posting failure names the budget by **code** and the document by **number**
  instead of by UUID, so the person reading it can tell what to fix.
- The budget form stops describing the GL account as consequence-free. It says plainly that a budget
  with no GL account cannot be charged by a document.

Not in scope, deliberately: the posting still takes the expense account from `budget.account_id`.
Widening it to the line's own account (`document_line.gl_account`, resolved item → type default →
budget) would let a budget legitimately span several accounts, but it changes what a settlement
entry debits and belongs in its own change with its own scenarios.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-engine`: submit SHALL refuse a document whose lines charge a budget with no GL account,
  before reserving budget, naming the budget.
- `gl-journal`: a posting stranded for want of a GL account SHALL name the budget by code and the
  document by number, and SHALL become postable again once the account is named.
- `web-documents`: the submit refusal SHALL tell the submitter which budget is unmapped and where
  the account is set.
- `web-budgets`: the budget form SHALL state that a budget with no GL account cannot be charged.

## Impact

**Backend**
- `back/src/modules/document/document.service.ts` — the submit path: a new pre-reserve check over
  the lines' budgets.
- `back/src/modules/gl/gl-posting.service.ts:518,661` — the two `has no account_id` throws; message
  content only, not the resolution rule.
- `back/src/modules/gl/gl-posting-sweeper.service.ts` — the bounded-retry rule gains a way back for
  this one cause.

**Frontend**
- `front-end/src/views/documents/*` — surfacing the refusal.
- `front-end/src/views/budgets/BudgetFormView.vue` and `i18n/locales/*/budgets.ts`
  (`glAccountHint`) — the hint that currently contradicts the ledger.

**Data**
- One additive migration: a nullable `gl_posting_attempt.blocked_by_budget_id`, so a stranded
  posting records *which* budget blocked it and naming that budget's account can un-strand exactly
  those postings. No column is dropped or rewritten.
- `budget.gl_account` and `budget.account_id` already exist and the create/update DTOs already
  accept `glAccount`; nothing new is needed to name an account.
- The live company's 7 budgets need accounts named before any payment can post; that is
  configuration, done through the budget form, not part of this change.

**Invariants** — none relaxed. No `budget_txn` is written, read, or reordered; the reserve → actual →
release sequence is untouched; the refusal is raised *before* the reservation, so invariant 4 never
sees a partial state. Company scoping and permission-code authorization are unchanged.
