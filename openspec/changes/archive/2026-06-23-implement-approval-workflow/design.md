## Context

The scaffold provides `workflow`, `workflow_step`, `approval_delegation`, `approval_log`
(append-only — `LedgerGuardSubscriber` already guards it). document-engine binds a
`workflow` at submit, reserves holds, and exports `DocumentSubmitService.releaseDocumentHolds`.
budget-control exports `settle` / `executeTransfer` / `executeAdjustment`; multi-company
exports `WorkingTimeService`. rbac's `user_company_role` maps users → company roles. No
schema change.

State model used: document-engine leaves a submitted document `SUBMITTED`,
`current_step_no = 0`. approval-workflow's `start` moves it to `IN_APPROVAL` at the first
applicable step; APPROVE advances `current_step_no`; the last step → `APPROVED` →
post-action → `COMPLETED`. REJECT → `REJECTED`; RETURN → `DRAFT`.

## Goals / Non-Goals

**Goals**
- Workflow/step/delegation config CRUD.
- Routing: applicable-step filtering by `base_total_amount`, step completion by mode,
  advancement, terminal `APPROVED`→post-action→`COMPLETED`.
- Approver resolution (user or role holders) + delegation rerouting with `delegated_from`.
- Invariant 8 enforcement: no self-approval (acting user or delegator == creator), no
  chained delegation.
- Append-only actions; reject/return release holds.
- Post-action engine (CUT_BUDGET/TRANSFER/ADJUST/employee) atomic with the terminal
  transition + bounded retry.
- SLA due-time computation + manual `escalate`.

**Non-Goals**
- The scheduler that fires SLA escalation (cron/queue → notifications slice).
- `condition_json` workflow selection (workflow bound at submit).
- Async post-action retry queues; `CREATE_PO` generation.

## Decisions

### D1 — Applicable steps by amount band
`applicableSteps(document)` = `document.workflow`'s `workflow_step`s ordered by `step_no`
where the band contains `base_total_amount`: `(amount_min == null || base >= amount_min)
&& (amount_max == null || base <= amount_max)`. The CFO-above-500k scenario is a step with
`amount_min = 500000`. `start` sets `current_step_no` to the first applicable step.

### D2 — Step completion derived from approval_log (no step-instance table)
There is no per-step-instance row, so completion is computed from `approval_log` filtered
by `(document, step_no, action = APPROVE)`:
- SEQUENTIAL / PARALLEL_ANY → complete once ≥ 1 APPROVE exists for the step.
- PARALLEL_ALL → complete once the set of distinct approvers (counting the delegator, not
  the delegate, as the principal) covers every eligible approver of the step.
On completion, advance to the next applicable step; if none remain → terminal approval.

### D3 — Approver resolution + delegation (one hop)
`eligibleApprovers(step, document)`:
- `approver_user_id` → `[that user]`; else `approver_role_id` → users with that role in the
  document's company via `user_company_role` (active window).
- For each principal approver, an **active** `approval_delegation` (delegator = principal,
  `start_date <= today <= end_date`, status ACTIVE, doc-type null or matching, amount
  limit null or `>= base_total_amount`) yields an eligible *delegate* whose `delegated_from`
  is the principal. The delegate's own delegations are **not** consulted (one hop only —
  no chaining). Result: a list of `{ userId, delegatedFrom? }` allowed to act on the step.

### D4 — Self-approval block (invariant 8)
`act` rejects when `actingUserId === document.created_by` OR (acting as a delegate and)
`delegatedFrom === document.created_by`. Enforced before writing the log, so a creator can
never approve their own document directly or by delegating it.

### D5 — Actions, all logged (append-only)
`act(documentId, { action, actingUserId, remark })`:
1. Load document (IN_APPROVAL), resolve the current step's eligible actors; verify
   `actingUserId` is among them (capture `delegatedFrom`); else reject (403/forbidden).
2. Apply the self-approval block (D4).
3. Insert an `approval_log` row (action, approver = actingUserId, `delegated_from`, remark,
   `acted_at`).
4. Branch: REJECT → `REJECTED` + `releaseDocumentHolds`; RETURN → `DRAFT` +
   `releaseDocumentHolds`; DELEGATE → log only (reassignment handled by resolution);
   APPROVE → evaluate completion (D2) and advance or finalize (D6).
All within one `em.transactional` so the log + state move atomically.

### D6 — Terminal approval + post-action (atomic, retried)
When the final step completes: set `APPROVED`, run `post_action`, set `COMPLETED` — all in
the same transaction as the last APPROVE. `PostActionService.run(document, tem)` dispatches
on `document_type.post_action`:
- `CUT_BUDGET` → for each line with a budget, `settle(documentId, budgetId, baseLineAmount)`
  (reserve → actual; releases any unused remainder).
- `TRANSFER` → load the document's `budget_movement`, `executeTransfer({documentId,
  fromBudgetId, toBudgetId, amount})`.
- `ADJUST_INCREASE` / `ADJUST_DECREASE` → `executeAdjustment` from the movement.
- `UPDATE_EMPLOYEE` / `TERMINATE_EMPLOYEE` → set `related_employee.status`.
- null / `CREATE_PO` → no-op.
A bounded `retry(n)` wraps the dispatch for transient faults; if it still throws, the
transaction rolls back (document returns to IN_APPROVAL — not stuck, re-actionable).
Because `settle`/`executeTransfer` accept the transactional `em`, they join this
transaction (consistent with the budget refactor done in document-engine).

### D7 — SLA
`stepDueAt(stepStart, slaHours, companyId)` = `WorkingTimeService.addWorkingHours`
(weekends + company holidays skipped). `escalate(documentId)` checks the current step's due
time and, when overdue with no active delegation, advances/flags for escalation and logs.
The periodic trigger is out of scope (notifications scheduler).

### D8 — Company-filter handling
`workflow`/`approval_delegation` are company-scoped; routing reads that touch scoped
relations use `{ filters: { company: false } }` with explicit company predicates (the
established pattern), since routing resolves within the document's company.

## Risks / Trade-offs

- **No step-instance table** → completion derived from `approval_log` each time; fine at
  this scale and keeps the schema as-is. PARALLEL_ALL eligibility is recomputed; documented.
- **Post-action atomic-in-approval** vs the spec's "retry transient" → bounded synchronous
  retry inside the txn gives atomicity (no stuck/half state); a durable async retry queue
  is a later enhancement (noted as non-goal).
- **One-hop delegation** is a deliberate invariant-8 stance; resolution never recurses.
- **Self-approval via role**: if the creator holds the approver role, they're filtered out
  of eligibility and the step may need another holder/escalation — surfaced as a blocked
  action, matching the spec ("block and escalate or reassign").

## Migration Plan

No DB migration. Steps: build `ApprovalWorkflowModule` importing budget, multi-company,
document-engine; add config + routing + post-action + SLA services, controllers, DTOs,
permission constants; register in `AppModule`; add unit/integration tests; `pnpm build` +
`pnpm test`. Rollback = revert the module.

## Open Questions

- On RETURN, should holds be released (treat like reject) or kept? Default: release, so a
  revise-and-resubmit re-reserves cleanly from step 1 (matches the reject/resubmit spec).
- Should `escalate` auto-advance to the next step or notify a superior? Default: advance to
  the next applicable step and log; superior-routing can come with notifications.
