## 1. Schema and entities

- [x] 1.1 Migration adds `document_approval_step` (document, step_no, step_name, approve_mode,
      sla_hours, approver_role_id, approver_user_id, show_signature_on_pdf, status, started_at,
      completed_at, superseded_at, source_workflow_step_id) with a partial unique index on
      `(document_id, step_no) where superseded_at is null`, and `document_approval_step_actor`
      (step_id, user_id). `source_workflow_step_id` is nullable and ON DELETE SET NULL (design D1,
      D6). No backfill — nothing has launched (design D9).
- [x] 1.2 DBML: both tables, with the note that the route is a snapshot and why (the same argument
      as the locked FX rate and the stored bank-file bytes).
- [x] 1.3 Entities `DocumentApprovalStep` and `DocumentApprovalStepActor`, registered in the ORM
      entity list.

## 2. Materialising the route

- [x] 2.1 Submit resolves the applicable steps ONCE through `WorkflowStepResolver.applicableSteps`
      and writes one row per step, inside submit's existing transaction alongside the budget and
      quota reserves (design D9). No new lock; no `budget_txn` or `quota_usage` of its own.
- [x] 2.2 A resubmission stamps the previous route's rows `superseded_at` and writes a fresh route
      from current configuration (design D7).
- [x] 2.3 A submit that resolves no applicable step keeps failing loudly —
      `stranded-submit-is-loud.spec.ts` must still pass, with the refusal now raised at submit.
- [x] 2.4 `routeStep(document)` / `routeSteps(document)` helpers own the `superseded_at is null`
      clause so no reader can forget it (design D2, risks).

## 3. The six readers

- [x] 3.1 `approval-routing.service.ts` — `start`, `act`, `canAct`, `pendingApprovers`,
      `stepComplete`, `advance` read the recorded route. `start` stamps the first row's
      `started_at`; advancing writes `completed_at` on the row left and `started_at` on the one
      entered, in the transaction that already locks the document row (design D9).
- [x] 3.2 `sla.service.ts` — due time from the recorded step's `started_at`, not
      `document.submitted_at`; the escalation target is the next recorded step.
- [x] 3.3 `approval-inbox.service.ts` — the worklist and its SLA column.
- [x] 3.4 `notification.scheduler.ts` — the overdue sweep.
- [x] 3.5 `reporting.service.ts` — step name, SLA, and time-in-step from `started_at`; delete the
      latest-approval-log derivation (design D4).
- [x] 3.6 `document-pdf.service.ts` — signature blocks from the recorded route (design D8).
- [x] 3.7 Grep afterwards: `WorkflowStep` may be imported only by configuration code, the resolver,
      the submit-time materialisation and the seed. Anything else is a reader that was missed.

## 4. The participant snapshot

- [x] 4.1 When a step opens, record its principals as `document_approval_step_actor` rows through
      `ApproverResolverService.principals` (design D5).
- [x] 4.2 `stepComplete` for PARALLEL_ALL counts the recorded actors, not live role holders.
- [x] 4.3 Delegation stays live and one hop — `eligible()` is unchanged; only the principal set is
      frozen.

## 5. Unfreezing configuration

- [x] 5.1 Delete `assertNoInFlight` and its three call sites in `workflow-config.service.ts`
      (design D6). The comment added by `honour-every-field-the-api-accepts` said this was coming.
- [x] 5.2 The frontend stops warning about in-flight step edits.

## 6. Tests

- [x] 6.1 Submit writes one row per applicable step, with the copied name/mode/SLA/target, and
      excludes a step the amount band rules out.
- [x] 6.2 Editing, renaming, re-targeting and DELETING the configured step leaves a routing
      document's route and behaviour unchanged; `source_workflow_step_id` goes null on delete.
- [x] 6.3 A later step's SLA is measured from its own `started_at`: a three-step route whose first
      approver overruns does NOT leave step 2 instantly overdue. This is the cascade the change
      exists to stop — assert the sweep escalates nothing.
- [x] 6.4 Advancing stamps `completed_at` and `started_at` atomically with the approval.
- [x] 6.5 PARALLEL_ALL: a user granted the role mid-step does not join it; a user who loses the
      role mid-step is still waited for; a delegate may act for a recorded actor.
- [x] 6.6 A resubmission supersedes the old route and picks up a step added in the meantime.
- [x] 6.7 Re-exporting a PDF after the workflow changed produces the same signature blocks.
- [x] 6.8 The ageing report's time-in-step is the current step's own elapsed time.
- [x] 6.9 A step may be added, edited and deleted while a document is in approval, and the
      in-flight document is unaffected — the inverse of the tests deleted with the guard.
- [x] 6.10 Concurrency: the existing routing concurrency test still holds — two approvals on one
      step produce one advance.
- [x] 6.11 Each new test must fail with its feature removed. Check it.

## 7. Checks

- [x] 7.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
      back: 1525 passed (+15 from this change), 1 failed — `attendance-period.service.spec.ts:563`,
      the pre-existing time bomb pinning `2026-07-15` against a 30-day correction window.
      Attendance is untouched here. `nest build` clean; front-end 807 tests and `vue-tsc` clean.
- [x] 7.2 The migration adds two tables and nothing else — `Migration20260828000000` has exactly two
      `create table` statements; the DBML carries the same two.
- [x] 7.3 `openspec validate --all` passes. This change validates ✓; the single failure is
      `escalate-to-someone-not-past-them`, which carries a `proposal.md` and no deltas yet.
- [x] 7.4 Do NOT edit `openspec/specs/**` by hand. The 14 changed files there are the three prior
      archive syncs, untouched by this change.
