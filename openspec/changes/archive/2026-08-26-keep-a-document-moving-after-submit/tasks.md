## 1. The end-to-end harness (already written — verify and keep)

No entities and no migration: this change adds no table and no column, so the usual
entity-then-migration step does not apply. The harness comes first instead, because every fix below
is verified by a check in it that fails today.

- [x] 1.1 `back/playwright.config.ts` reads `back/.env` (no dotenv dependency in this workspace),
      runs one worker with `fullyParallel: false`, and points its `webServer` health check at the
      app's global prefix (`/api-new`) rather than `/`.
- [x] 1.2 `back/e2e/support/api.ts` — one authenticated caller per person, with an `attempt()`
      variant that returns status and body so a test can assert on a refusal.
- [x] 1.3 `back/e2e/support/money.ts` — decimal-string arithmetic (`add`/`sub`/`cmp`/`eq`) so no
      assertion coerces money to a JavaScript number.
- [x] 1.4 `back/e2e/support/provision.ts` — idempotent sandbox over the public API: department
      `E2E-SBX`, a requester and two approvers, a two-step workflow, a `dept_doc_type` mapping per
      active type, one `budget_node` + `budget` per type, activated through a real `BUDGET_PLAN`.
- [x] 1.5 `back/e2e/support/flows.ts` — author a submittable draft from the TYPE's configuration
      (required fields, attachment, budgeted lines), walk the steps as whoever the step names, and
      read balances/ledger/trail.
- [x] 1.6 `back/e2e/support/expected-types.ts` — the written list of covered types, with the
      coverage guard in `00-sandbox.e2e.spec.ts`.
- [x] 1.7 `back/e2e/app.e2e.spec.ts` — the smoke test asks `/api-new`, which is where the greeting
      lives once the global prefix is set.
- [x] 1.8 Spec files: `10-disbursement-lifecycle` (four endings × every CUT_BUDGET type),
      `20-budget-plan`, `30-plain-document`, `40-approval-rules`, `50-workflow-shapes`,
      `60-concurrency`, `70-document-reads`.
- [x] 1.9 Concurrency checks for the two locked paths the design names: distinct `doc_no` under
      concurrent creates, and exactly one `RESERVE` when two submissions race for the last of a
      budget.
- [x] 1.10 Run the suite and record the baseline: 83 checks, 69 passing, 14 failing across the
      three defects below (`docs/e2e-run-2026-08-26.md`).

## 2. A returned document can be sent again

- [x] 2.1 `DocumentRouteService.materialise()` — flush the supersede of the previous live
      `document_approval_step` rows before creating the replacement rows, inside the existing
      transaction, so `document_approval_step_live_uniq` is evaluated against the state the code
      believes it wrote.
- [x] 2.2 Unit spec: a document with a live route, materialised again, ends with the old rows
      carrying `superseded_at` and exactly one live row per applicable step.
- [x] 2.3 Verify the twelve e2e checks named "returned, then resubmitted, still reaches COMPLETED"
      pass (eleven `REC*` types plus `SPEND_HIST`).

## 3. A withdrawal stays withdrawn

- [x] 3.1 `DocumentSubmitService.cancel()` — re-read `document` under
      `LockMode.PESSIMISTIC_WRITE` before the status check and the write, matching `act()`.
- [x] 3.2 `ApprovalRoutingService.start()` — same lock, so its `status !== SUBMITTED` guard is
      evaluated against a row nobody else can be writing.
- [x] 3.3 Confirm the lock order is unchanged everywhere (document row first, then control points),
      so no new deadlock edge is introduced; `releaseDocumentHolds` still runs after the cancel
      transaction commits and stays idempotent.
- [x] 3.4 Concurrency spec: a cancel and a route-start racing on one document leave it `CANCELLED`,
      with its `CANCEL` row, its `RESERVE`/`RELEASE` pair, and no route rows opened.
- [x] 3.5 Verify the e2e check "withdrawing between submit and routing must not be undone by the
      router" passes.

## 4. The routability gate judges the amount the document carries

- [x] 4.1 `WorkflowStepResolver.applicableSteps()` — accept an optional base amount; when absent,
      keep reading `document.budget_base_total_amount ?? document.base_total_amount ?? '0'` as it
      does now, so routing's call site is untouched.
- [x] 4.2 `DocumentSubmitService.submit()` — pass the `budgetToBase(total)` it has already
      computed into the routability gate (no hoist needed: the budget rate is resolved well above
      the gate). The gate stays where it is, above the write transaction, so a refused submit still
      reserves nothing.
- [x] 4.3 Unit spec: a workflow whose only step carries `amount_min` above zero accepts a first
      submission inside that band, and refuses one below it.
- [x] 4.4 Unit spec: a resubmission whose lines changed is judged on the new figure, not on the
      figure its previous attempt stamped.
- [x] 4.5 Verify the e2e check "a document that engages no step at all is refused at submit, holding
      nothing" passes in both halves — the small document refused, the large one routed.

## 5. A failed auto-start is audible

- [x] 5.1 `ApprovalSubmittedListener.onSubmitted()` — raise the catch-all branch from `debug` to
      `error`, naming the document and stating that its holds are still taken.
- [x] 5.2 Keep the "no applicable steps" branch and its wording, minus the advice that a workflow's
      lowest band must start at zero — that advice described the defect fixed in group 4, not a
      rule.
- [x] 5.3 Unit spec: a `start()` that throws produces one error-level log line carrying the
      document id.

## 6. Close the loop

- [x] 6.1 Re-run the full e2e suite; all 83 checks pass.
- [x] 6.2 Re-run `pnpm test` (Vitest) — no unit spec regressed, particularly the routing and submit
      suites.
- [x] 6.3 Recover the documents the baseline runs left behind: 37 stranded in `SUBMITTED` routed
      through `POST /documents/:id/start` (the call the listener could not complete), and the four
      left `IN_APPROVAL` with a `CANCEL` in their trail withdrawn again. Nothing is stranded and no
      budget is held by a document nobody can act on.
- [x] 6.4 Update `openspec/specs/approval-workflow/spec.md` and
      `openspec/specs/platform-foundation/spec.md` from the deltas.
