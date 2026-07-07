## Context

Approval Workflow is largely built. This change closes three concrete gaps without new
tables: (1) `workflow.condition_json` is persisted but never evaluated, so routing cannot
branch on amount range or requester `job_level`; (2) `SlaService.escalate()` and
`SlaService.stepDueAt()` exist and compute working-day SLA via the company `holiday_calendar`,
but no scheduler ever calls `escalate()` and there is no auto-forward — only an hourly overdue
notification; (3) the web step editor lacks amount-range / per-person-approver / level inputs,
and the inbox and document detail show no SLA or escalation state.

Constraints: `approval_log` and `budget_txn` are append-only; no-self-approval and one-hop /
no-chaining delegation must hold after any reassignment; all reads/writes are company-scoped;
authorization is by permission code (`WORKFLOW_MANAGE`, `DOC_APPROVE`). Existing files of
interest: `approval/workflow-config.service.ts`, `document/dept-doc-type.service.ts` (current
single-workflow binding), `approval/sla.service.ts`, `approval/approver-resolver.service.ts`,
`approval/approval-routing.service.ts`, `notification/notification.scheduler.ts`.

## Goals / Non-Goals

**Goals:**
- Evaluate `condition_json` (amount band + `job_level`) at workflow-binding time, with a
  deterministic most-specific-wins tie-break and a safe fallback to the default workflow.
- Turn SLA escalation into a triggered, transactional, auditable engine that reassigns overdue
  items (to superior or next step), notifies the new actor, and appends an `approval_log` row.
- Expose amount range, per-person approver, and level condition in the web step/workflow editor.
- Surface SLA due time, overdue badges, and escalation timeline entries in the approver UI.

**Non-Goals:**
- No new tables or columns; reuse `condition_json`, `job_level`, `amount_min/max`, `sla_hours`,
  `holiday_calendar`.
- No change to budget/quota balance math, post-action behaviour, or the reserve→actual→release
  ledger. Escalation does not touch budget.
- No change to the one-hop delegation rule or the inbox eligibility/self-approval semantics.

## Decisions

**1. Step-level gating, not workflow selection.** The `dept_doc_type` mapping is unique on
(department, document_type), so there is exactly one workflow per dept+doctype — workflow-level
selection by amount/level has no candidate set without dropping that uniqueness. Decision (user
confirmed): keep one workflow per dept+doctype and gate **steps** instead. Amount is already
gated by `workflow_step.amount_min/amount_max`; add a nullable `workflow_step.condition_json`
carrying `{ "jobLevels": ["MANAGER"] }`. A `WorkflowStepResolver` resolves the requester's
`employee.job_level` (via `Employee.user = document.created_by`) once per document and returns the
applicable steps: amount band (Decimal compare, never float) AND job-level match; a step with no
`jobLevels` applies to everyone. Chosen over relaxing the `dept_doc_type` unique constraint
(larger blast radius, re-bind-at-submit complexity) because it mirrors the existing amount-band
pattern and needs only one additive column.

**1b. `ESCALATE` action.** `approve_action` gains an `ESCALATE` value (TS enum + DBML + a
migration altering the `approval_log.action` check constraint) so a system escalation is an
auditable, append-only row distinct from a manual `DELEGATE`. The escalation row's `approver` is
the overdue principal (the subject the SLA was waiting on); `acted_at` is the sweep time.

**2. Escalation trigger lives in the existing scheduler.** Extend
`notification.scheduler.ts` so the hourly sweep, after notifying, calls a new
`SlaService.escalateOverdue()` per overdue step. Reuse `stepDueAt()` for working-day math. A
separate cron module was considered but rejected to avoid a second scheduling surface.

**3. Escalation reassignment + audit, transactional.** `escalateOverdue()` runs inside one
`em.transactional()`: resolve the new actor via `ApproverResolverService` (superior lookup, or
advance step), skip if the candidate is the creator or an active delegation exists, append an
`approval_log` row with the escalation action and `delegated_from`/from-actor context, then update
the document's `current_step_no` if forwarding. No existing log row is mutated (append-only). No
budget/quota is touched, so no ledger transaction is paired here — the boundary exists only to keep
the log row and `current_step_no` update atomic.

**4. No superior data → forward to next step.** The schema carries no reporting/manager
relationship (no `manager_id` on `employee`/`app_user`), so escalation always forwards to the
next applicable step. `ApproverResolverService.superior()` is added as a null-returning seam for
a future schema that adds reporting lines. An overdue item with no further applicable step is
left in place (still notified), never stuck.

**5. Frontend mirrors via shared Zod.** Extend the shared workflow-step schema with
`approverUserId`, `amountMin`, `amountMax` (string-decimal), and the workflow-level condition;
the step editor renders a role/person toggle, amount inputs, and a level multiselect. Inbox and
detail consume new read-only fields (`slaDueAt`, `overdue`, escalation log entries) already
produced by the backend.

## Risks / Trade-offs

- [Ambiguous `condition_json` across candidate workflows could pick the wrong chain] → Define a
  deterministic most-specific-wins order and add unit tests for amount and `job_level` selection;
  fall back to the default when no predicate matches rather than erroring.
- [Escalation sweep racing with a concurrent approve on the same step could double-handle] → Do
  the reassignment under the step's row context inside `em.transactional()` and re-check the
  document is still `IN_APPROVAL` on the same `current_step_no` before writing; add a concurrency
  test (approve vs escalate on one step).
- [Escalating to a superior who is the creator would breach no-self-approval] → Explicit skip in
  the resolver, covered by a scenario/test; forward to next step instead.
- [Client/server validation drift on the new step fields] → Single shared Zod schema mirrors the
  DTO; reject inverted amount ranges on both sides.

## Migration Plan

No schema migration (existing columns). Deploy backend (selector + escalation) and frontend
together; the new read fields are additive. Rollback is code-only — reverting leaves data intact
because no rows are restructured and `approval_log` escalation rows remain valid history.

## Open Questions

- Superior-based escalation is deferred: it needs a reporting relationship the schema does not
  model yet. A follow-up change could add `employee.manager_id` and make
  `ApproverResolverService.superior()` real, plus a per-step/per-workflow escalation policy.
