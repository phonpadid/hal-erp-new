## 1. Entity and migration

- [x] 1.1 Add a nullable `blockedByBudget?: Budget` (`fieldName: 'blocked_by_budget_id'`) to
  `GlPostingAttempt` in `back/src/modules/gl/gl-posting.entities.ts`, documenting that it records
  the cause of the last attempt and is cleared on every other outcome.
- [x] 1.2 Add `blocked_by_budget_id uuid` with its FK (`on delete set null`) and index to
  `erp_approval_system.dbml`'s `gl_posting_attempt`, matching the column names in the entity.
- [x] 1.3 Generate the migration and check the emitted SQL is purely additive — one `add column`,
  one FK, one index; no drop, no rewrite, no default backfill.

## 2. Refuse the submit

- [x] 2.1 In `DocumentSubmitService.submit`, inside the step-4 enablement loop that already refuses
  an inactive budget, refuse a line whose `l.budget.account` is unset. Read the FK, not
  `glAccount`. Message names `budget_node.code`, `budget_node.name`, the line no, and where the
  account is set.
- [x] 2.2 Confirm the check sits before `reserveLines` is built and outside the write transaction,
  so a refusal leaves the document `DRAFT` with no `budget_txn` and no document number.
- [x] 2.3 Confirm `l.budget.node` is reachable for the message without an extra query per line —
  lines are loaded with `populate: ['taxCode', 'budget']`; extend the populate to the node if
  needed rather than querying inside the loop.
- [x] 2.4 Unit tests: refused when `account_id` is null; refused when `gl_account` is non-empty but
  `account_id` is null; passes when the account is set; silent for a budget-less zero line; refused
  for both a `CUT_BUDGET` type and an accruing type.
- [x] 2.5 Test that a refused submit wrote no `budget_txn` and left the document `DRAFT`. Its
  `doc_no` is issued by `createDraft`, not by submit, so the refusal neither consumes nor releases
  a number — assert it is unchanged rather than absent.

## 3. Record why a posting is blocked

- [x] 3.1 In `GlPostingService`, set `blockedByBudget` when the settlement path (`:518`) or the
  accrual path (`:661`) fails for a missing `budget.account_id`.
- [x] 3.2 Clear `blockedByBudget` on every other outcome — POSTED, SKIPPED, and any FAILED with a
  different cause — so it can never describe a stale cause.
- [x] 3.3 Rewrite both throw messages to name `budget_node.code` and `document.doc_no` and to say
  the account is set on the budget. Do not change which column the expense side reads.
- [x] 3.4 Tests: the blocked attempt records the budget id; a later success clears it; a later
  failure for an unmapped role clears it and records its own message.

## 4. Naming the account revives what it blocked

- [x] 4.1 In `BudgetService.update`, detect the unset → set transition on `account` and reset the
  `GlPostingAttempt` rows whose `blockedByBudget` is this budget to `PENDING` with `attempts = 0`,
  retaining `last_error`. NOTE: `update` also had to be fixed to resolve `glAccount` → `account`
  at all (it wrote only the string), and to read and flush in ONE entity manager — it read through
  `get()`'s fork and flushed `this.em`, so every budget edit was a silent no-op.
- [x] 4.2 Share the budget update's unit of work — one flush — so a failed update cannot leave
  postings re-queued.
- [x] 4.3 Leave `JournalService.requeue` and `GL_POST_RETRY` untouched; this path requires only
  `BUDGET_MANAGE`.
- [x] 4.4 Tests: two blocked attempts revive together; an attempt blocked by a different budget is
  untouched; changing an existing account re-queues nothing; a rejected update re-queues nothing.

## 5. Name the budget on the undelivered read

- [x] 5.1 Extend the undelivered-postings read to carry `budget_node.code` and `budget_node.name`
  where `blocked_by_budget_id` is set, without adding a query per row.
- [x] 5.2 Test the read returns the code alongside the error, and is unchanged for rows with no
  blocking budget.

## 6. Surface the refusal in the document UI

- [x] 6.1 Show the refusal with the existing "reason a submit was refused stays readable" treatment,
  naming the budget and saying a `BUDGET_MANAGE` holder sets the account. NOTE: no new UI was
  needed — that treatment already renders the server's sentence persistently; the work was making
  the server's sentence carry the budget code and who can fix it, plus a test pinning both.
- [x] 6.2 Make sure the completeness prompt does not also claim a form field is missing, and no
  action offers to reopen the wizard for this refusal.
- [x] 6.3 i18n keys with en/la parity; no hardcoded strings, no hardcoded colours.
- [x] 6.4 Component test: the refusal renders with the budget code, persists, and raises no
  missing-field prompt.

## 7. Tell the truth on the budget screens

- [x] 7.1 Rewrite `budgets.form.glAccountHint` in every locale to state that a budget naming no
  account cannot be charged by a document; drop the "leave it empty when spending posts to several
  accounts" advice.
- [x] 7.2 Check the key is not already used elsewhere with the old meaning before editing, and keep
  en/la/zh in step.
- [x] 7.3 Mark account-less budgets in the budget list with a themed tag and an i18n tooltip saying
  documents cannot charge it yet.
- [x] 7.4 Component tests: the form states the consequence; the list marks an account-less budget and
  leaves a mapped one unmarked.

## 8. Verify

- [x] 8.1 Run the backend unit suite and the frontend suite; both green.
- [x] 8.2 Drive it in the browser against the dev stack. VERIFIED against `hal_erp`: a submit
  charging the unmapped `1.101` is refused (`RECADMIN-HAL-2026-0002` stayed `DRAFT` with 0
  `budget_txn` rows), the refusal is the only message on screen — no contradictory field prompt —
  and the budget list marks all 7 account-less budgets with the Lao tooltip.
  NOT VERIFIED in the browser: naming an account and watching the stranded
  `RECADMIN-HAL-2026-0001` posting re-queue and post. That needs writing a GL account onto a real
  customer budget, which the user declined ("migration only"). The path is covered by the six
  DB-backed tests in `naming-an-account-revives-what-it-blocked.spec.ts`.
- [x] 8.3 State plainly in the change summary that until the live company's budgets name accounts,
  every budget-controlled submit is refused — the first symptom is "nobody can submit anything".
