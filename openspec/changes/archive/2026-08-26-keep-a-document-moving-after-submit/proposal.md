## Why

A full end-to-end run against a copy of the production database (`docs/e2e-run-2026-08-26.md`,
`demo_erp`, HALLogistic) drove every one of the company's thirteen active document types through create → submit → approve →
complete, and through reject, withdraw and return. Sixty-nine of eighty-three checks passed; the
fourteen that failed trace to **three defects in the seam between submitting a document and routing
it**, and each one ends the same way — a document that has stopped moving while looking like it is
still on its way.

None of the three is a missing capability. `approval-workflow` already requires that a returned
document can be resubmitted, that a withdrawal is recorded and terminal, and that the submit gate
resolve applicability "the same way routing does … never a second copy of it". All three
requirements are stated and none is met, because nothing exercised the paths that break them: the
existing e2e suite is a single smoke test that asks the root route for `Hello World!`.

## What Changes

**A returned document can be sent again.**
- `DocumentRouteService.materialise()` marks the previous attempt's `document_approval_step` rows
  superseded *in memory* and then persists the new rows in the same flush. MikroORM commits
  creates before updates, so the inserts hit `document_approval_step_live_uniq`
  (`(document_id, step_no) WHERE superseded_at IS NULL`) against rows that are still live, the whole
  routing transaction rolls back, and the document is left `SUBMITTED` — budget reserved, no route,
  in nobody's queue. Every one of the thirteen document types reproduces it.
- The supersede SHALL be flushed before the replacement rows are created, so the uniqueness the
  index expresses is evaluated against the state the code already believes it wrote.

**A withdrawal made before routing starts stays a withdrawal.**
- Routing starts from the `document.submitted` event, after the submit transaction commits. A
  cancel accepted in that window reads `SUBMITTED`, writes `CANCELLED` and releases the holds; the
  router, which read `SUBMITTED` a moment earlier, then writes `IN_APPROVAL` over it. The result is
  a document with a `CANCEL` row in its trail, a `RESERVE`/`RELEASE` pair holding nothing, and a
  status that puts it back in an approver's queue.
- Both `cancel()` and `start()` SHALL re-read the document under `LockMode.PESSIMISTIC_WRITE`, the
  lock `act()` already takes, so the status check and the status write cannot be separated.

**A workflow's lowest amount band no longer has to start at zero.**
- The routability gate on the submit path resolves applicable steps from
  `document.budget_base_total_amount`, which submit stamps *later in the same method*. On a first
  submission the column is null, the gate compares every band against `0`, and a workflow whose
  lowest step has an `amount_min` above zero refuses every document it receives — including one
  twenty times the band — with "No approval step applies to this document". On a resubmission the
  gate reads the *previous* attempt's figure, so the same document can be judged on an amount it no
  longer carries.
- The gate SHALL resolve applicability against the base amount this submission computes, not
  against whatever the column happens to hold. **BREAKING** for anyone relying on the workaround the
  current behaviour forces: the auto-start listener's advice that "the lowest band must start at
  zero" is a symptom of this bug, not a rule, and stops being one.

**A route that could not be written says so.**
- `ApprovalSubmittedListener` catches every failure that is not the "no applicable steps" message
  and logs it at `debug`, which is off by default. That is how the resubmission defect above stayed
  invisible: a stranded document produced no line anywhere. A failure to route a document that has
  already committed its holds SHALL be logged at error, naming the document.

**The flows are covered by an end-to-end suite that runs them for real.**
- A Playwright suite (83 checks) provisions its own sandbox department, approvers, workflow,
  document-type mappings and budgets — all through the public API, all idempotent — and then drives
  every active document type through all four endings, plus the approval rules, the workflow
  shapes (amount bands, `PARALLEL_ALL`/`PARALLEL_ANY`, delegation), the two concurrency locks, and
  the reads a participant depends on. A document type added to a company fails a coverage guard
  rather than quietly going untested.

## Capabilities

### New Capabilities

None. Every rule involved belongs to a capability that already exists.

### Modified Capabilities

- `approval-workflow`: three requirements gain the guarantees their current text assumes.
  *Reject Returns and Releases* — superseding the previous route SHALL be durable before the
  replacement route is written, and a resubmission that cannot be routed SHALL fail loudly rather
  than leaving the document `SUBMITTED`. *Authorized, Append-Only Actions with Hold Release* — a
  withdrawal accepted while a document is `SUBMITTED` SHALL be final, and routing SHALL NOT
  transition a document it did not find `SUBMITTED` at the moment it writes.
  *Auto-Start Routing on Submit* — the routability gate SHALL resolve applicability against the base
  amount the submission computes, and a route that fails to open SHALL be reported at error level.
- `platform-foundation`: *Backend test tooling* extends to state what the end-to-end suite must
  cover — every active document type, each of the four endings, and the concurrency points the
  design names — and that it SHALL provision its own fixtures through the public API rather than
  depending on a particular company's configuration.

## Impact

**Build-order capabilities touched:** `document-engine` (submit path) and `approval-workflow`
(routing). `budget-control` is read but not changed — the ledger arithmetic was verified correct in
every passing flow, including the settle-and-release split and the control-point block at 100%.

**Invariants:** none is relaxed. Two are *restored*: invariant 4 (reject/cancel ALWAYS releases) is
already honoured on the money side but the withdrawal race leaves the document in a state the
invariant does not describe, and invariant 2 (append-only) is untouched — no fix rewrites a
`budget_txn` or an `approval_log` row. The pessimistic-write lock this change adds to `cancel()` and
`start()` is the same lock the concurrency rules already require around a document's status
transitions.

**Code**
- `back/src/modules/approval/document-route.service.ts` — `materialise()`: flush the supersede
  before creating the replacement rows.
- `back/src/modules/approval/approval-routing.service.ts` — `start()`: lock the document row.
- `back/src/modules/document/document-submit.service.ts` — `cancel()`: lock the document row;
  `submit()`: compute the budget base amount before the routability gate and pass it in.
- `back/src/modules/approval/workflow-step.resolver.ts` — `applicableSteps()` accepts an explicit
  base amount instead of reading a column the caller has not yet written.
- `back/src/modules/approval/approval-submitted.listener.ts` — log a failed auto-start at error.
- `back/e2e/` — the suite and its fixtures (`support/api.ts`, `support/provision.ts`,
  `support/flows.ts`, `support/money.ts`, `support/expected-types.ts`, and the spec files).
- `back/playwright.config.ts` — loads `back/.env`, one worker, and points the smoke test at the
  app's global prefix.

**Data:** none. No migration, no backfill. Documents already stranded by the resubmission defect
stay `SUBMITTED` until they are submitted again, which will then work; three runs left 37 of them in
the sandbox department, holding 51,000,000 LAK between them, and four documents in the
`CANCELLED`-then-`IN_APPROVAL` state — kept deliberately as evidence
(`docs/e2e-run-2026-08-26.md` carries the query to re-count them).

**Not in scope:** SLA escalation (needs elapsed time, not covered by this run), quota-controlled
types (this company configures none), and the stock, journal-voucher and HR post-actions (no active
document type in this company carries them).
