## 1. Schema and entities

- [x] 1.1 Migration: `workflow_step` gains `escalate_to_role_id` / `escalate_to_user_id`;
      `document_approval_step` gains the same two (copied at submit) plus `escalated_to_user_id`
      and `escalated_at`. All nullable, all ON DELETE SET NULL on the user/role side.
- [x] 1.2 DBML: the four columns on `workflow_step` / `document_approval_step`, with the note that
      escalation changes who may act and never how many approvals are required.
- [x] 1.3 Entities: the new fields on `WorkflowStep` and `DocumentApprovalStep`.

## 2. Resolution

- [x] 2.1 `StepTarget` gains `escalatedTo`; `eligible()` includes the escalated target as an actor
      alongside principals and their delegates (design D1).
- [x] 2.2 The escalated target is NOT added to `document_approval_step_actor` — that set is
      PARALLEL_ALL's coverage requirement, and an escalation must not add a required approval.
- [x] 2.3 The no-self-approval rule still applies: an escalation target who is the document's
      creator is not offered the step.
- [x] 2.4 Delegation windows compare against the company's day via `localDateIn(now,
      company.timezone)` from `common/time/company-clock`, not the server's UTC day (design D6).

## 3. The sweep

- [x] 3.1 `escalateOverdue` stops moving `current_step_no`. It records `escalated_to_user_id` +
      `escalated_at` on the overdue step and returns who was added, or null when nothing was
      escalated (design D1).
- [x] 3.2 No configured target → escalate nothing, notify the approver again, write no
      `ESCALATE` row (design D3).
- [x] 3.3 `PARALLEL_ALL` → never reassigned whatever it names; notified again like a step with no
      target (design D4).
- [x] 3.4 Already escalated → notify, write no second row (`escalated_at` makes it idempotent —
      design D5).
- [x] 3.5 The `ESCALATE` remark names both ends; `approval_log.approver` stays the overdue
      principal, because that column means "who acted" and the target has not acted yet.
- [x] 3.6 The escalation target is resolved AT escalation time (role holders may have changed);
      only which role/person is frozen with the route.
- [x] 3.7 The transaction is the existing one — it locks the document row and now writes two column
      updates and one log row. No `budget_txn`, no `quota_usage`, no new lock.
- [x] 3.8 `notification.scheduler` notifies the escalation target when one is added, and keeps
      chasing the approver when none is.

## 4. Configuration

- [x] 4.1 `escalateToRoleId` / `escalateToUserId` on the step DTOs, resolved in the active company
      by the same `resolveRole` / `resolveApprover` the approver target uses.
- [x] 4.2 The route materialisation copies both onto `document_approval_step`.
- [x] 4.3 The workflow read surface returns them so the config UI can show them.

## 5. Frontend

- [x] 5.1 The step editor names an escalation target (role or person), from the active company's own
      lists; empty is valid.
- [x] 5.2 The step summary and the workflow detail view show it, and say that an empty target means
      the step is chased rather than skipped.
- [x] 5.3 i18n in the three locales.

## 6. Tests

- [x] 6.1 An overdue step with a target: the document stays on the step, the target is recorded and
      notified, one `ESCALATE` row names both ends — and the step's approval has still not happened.
      This is the defect the change exists to remove; assert `current_step_no` did NOT move.
- [x] 6.2 The escalation target may then approve, and routing advances normally.
- [x] 6.3 No target → nothing escalated, no row, the document stays put.
- [x] 6.4 `PARALLEL_ALL` with a target → not reassigned, no actor added.
- [x] 6.5 Sweeping twice → one `ESCALATE` row.
- [x] 6.6 An escalation target who is the creator is not made eligible.
- [x] 6.7 A delegation window is read on the company's day: a UTC+7 company's delegation ending "the
      31st" is still active at 08:00 local on the 31st (which is the 30th in UTC).
- [x] 6.8 A step's escalation target cannot be a role or user of another company.
- [x] 6.9 Each new test must fail with its feature removed. Check it.

## 6b. Found at archive

- [x] 6b.1 `reporting`'s ageing requirement justified reading time-in-step from `started_at` partly
      by "a step reached by escalation — which logs against the step it left". This change makes
      that case impossible: escalation no longer leaves a step. The reason still holds for a
      resubmission's first step, so the sentence is MODIFIED rather than dropped — a justification
      that cites something that cannot happen teaches the next reader something false.

## 7. Checks

- [x] 7.1 `npm test` in `back/`, `nest build`, frontend `test` + `typecheck`; `PIPESTATUS`.
      back: 1533 passed (+8 from this change), 1 failed — `attendance-period.service.spec.ts`,
      the pre-existing time bomb pinning `2026-07-15` against a 30-day correction window, confirmed
      by running that file alone. Attendance is untouched here. `nest build` clean; front-end 807
      tests and `vue-tsc` clean.
- [x] 7.2 The migration adds six columns across two tables (`escalate_to_role_id` /
      `escalate_to_user_id` on each, plus `escalated_to_user_id` / `escalated_at` on the route step)
      and nothing else. The DBML carries the same six.
- [x] 7.3 `openspec validate --all` passes — 72 passed, 0 failed, the first clean run of the series
      now that no sibling proposal is left without deltas.
- [x] 7.4 Do NOT edit `openspec/specs/**` by hand. The 15 changed files there are the four prior
      archive syncs, untouched by this change.
