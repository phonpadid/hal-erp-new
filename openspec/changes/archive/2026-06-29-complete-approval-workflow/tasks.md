## 1. Backend — Conditional Step Routing (amount + job_level)

- [x] 1.0 Add `condition_json` (text, nullable) to the `workflow_step` entity + a migration; add `ESCALATE` to the `approve_action` enum (TS enum + DBML + migration altering the `approval_log.action` check constraint).
- [x] 1.1 Define the step `condition_json` shape (`{ jobLevels?: string[] }`) and a tolerant parser (empty/legacy ⇒ no restriction).
- [x] 1.2 Add a `WorkflowStepResolver` that resolves the requester's `employee.job_level` and returns the applicable steps for a document (amount band via Decimal compare, never float, AND job-level match).
- [x] 1.3 Wire `WorkflowStepResolver.applicableSteps` into `ApprovalRoutingService` (replace its private `applicableSteps`) so start/act honour amount + level; keep one workflow per dept+doctype.
- [x] 1.4 Unit tests: amount picks the longer chain (600k includes the higher step, 400k skips); a job-level-restricted step is included for a MANAGER and skipped for STAFF; an unrestricted step applies to all.

## 2. Backend — SLA Escalation Engine

- [x] 2.1 Add `SlaService.escalateOverdue()` that forwards an overdue step to the next applicable step and returns the reassignment decision (`fromStepNo`, `toStepNo`, `newApproverIds`), or null.
- [x] 2.2 Extend `ApproverResolverService` with a `superior()` seam (returns null — no reporting data in the schema) and apply the guards in escalation: suppress when the overdue step has an active delegate, and skip a target step whose only eligible actor is the creator.
- [x] 2.3 Run the reassignment in a single `em.transactional()` that locks the document row (`PESSIMISTIC_WRITE`): re-check the document is still `IN_APPROVAL` on the same `current_step_no`, append an `ESCALATE` row to `approval_log` (append-only, `approver` = the overdue principal), and update `current_step_no`. No budget/quota writes.
- [x] 2.4 Trigger from the existing hourly sweep in `notification/notification.scheduler.ts` and notify the new eligible actor (reuse the overdue notification template).
- [x] 2.5 Confirm working-day due-time math (`SlaService.stepDueAt()`) skips weekends and company `holiday_calendar` for the escalation decision.
- [x] 2.6 Unit tests: overdue item escalates + notifies + appends log; escalation skips the creator; active delegation suppresses escalation; holiday-aware due time.
- [x] 2.7 Concurrency test: a concurrent approve vs. escalation sweep on the same step does not double-handle the document.

## 3. Shared Schema

- [x] 3.1 Extend the shared workflow-step Zod schema/DTO with `approverUserId`, `amountMin`, `amountMax` (string-decimal), and reject inverted ranges (`amountMin > amountMax`).
- [x] 3.2 Extend the shared workflow schema with the selection condition (amount band + `jobLevels`), mirroring the backend `condition_json` validator.

## 4. Frontend — Workflow / Step Config UI

- [x] 4.1 In `DocConfigView.vue` step editor, add a role/person approver toggle bound to `approverRoleId` / `approverUserId` with a user picker.
- [x] 4.2 Add `amountMin` / `amountMax` inputs to the step editor, formatted per the currency `decimal_places`, validated via the shared schema.
- [x] 4.3 Add the step-level job-level condition (multiselect → `condition_json`) to the step editor and surface amount band + level restriction in the step summary chip; gate all affordances by `WORKFLOW_MANAGE`.
- [x] 4.4 Update the docConfig Pinia store / API client to send the new fields.

## 5. Frontend — SLA & Escalation Visibility

- [x] 5.1 Add `slaDueAt` / `overdue` to the pending-approvals model and store; render an overdue indicator and due time on inbox rows in `ApprovalInboxView.vue`.
- [x] 5.2 Show the current step's SLA due time and overdue state on `DocumentDetailView.vue`.
- [x] 5.3 Render escalation entries in `EventTimeline.vue` (escalated-from / to / when) alongside approve/reject/return.

## 6. Verification

- [x] 6.1 Run backend unit + concurrency tests (`vitest`) and the frontend type-check/build; confirm all new scenarios pass.
- [ ] 6.2 Manual smoke (Playwright or by hand): configure an amount/level-conditioned workflow, submit documents that route to different chains, let one breach SLA, and confirm escalation + inbox/timeline visibility end to end.
