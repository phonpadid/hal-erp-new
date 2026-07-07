## Context

Workflows and steps are configuration in the `workflow` / `workflow_step` tables. Today the
only mutations are `createWorkflow` and `addStep` in `WorkflowConfigService`. Two facts drive
the safety design:

1. **Routing reads steps live.** `ApprovalRoutingService.applicableSteps()` queries
   `workflow_step` at approval time, so editing or deleting a step mutates the routing of any
   document currently mid-approval, not just future ones.
2. **References.** `dept_doc_type.workflow` and `document.workflow` are both non-nullable FKs
   to `workflow`. `approval_log.stepNo` is a plain integer snapshot, not an FK to
   `workflow_step`, so approval history is independent of step rows.

Non-terminal (in-flight) document statuses are `SUBMITTED` and `IN_APPROVAL`; `DRAFT`,
`APPROVED`, `REJECTED`, `CANCELLED`, `COMPLETED` are terminal for routing purposes.

## Goals / Non-Goals

**Goals:**
- Full lifecycle for workflows (edit name/condition, toggle active, delete) and steps
  (edit, delete), under `WORKFLOW_MANAGE` and company scope.
- Guards that make destructive/edit operations safe against referential integrity and
  in-flight approvals, with clear rejection messages.
- Frontend affordances on the list and detail views, reusing the existing step form.

**Non-Goals:**
- No step reordering UI beyond editing `stepNo` (drag-reorder is out of scope).
- No soft-delete/versioning of workflows; delete is a hard delete gated by guards.
- No change to routing, SLA, or the append-only `approval_log`.

## Decisions

- **Workflow edit is unconditional; delete is guarded.** `PATCH /workflows/:id` updates
  `name`, `conditionJson`, `isActive` — all safe (name is cosmetic; `conditionJson` and
  `isActive` only affect selection of the workflow for *new* documents). `DELETE
  /workflows/:id` is rejected (`BadRequestException`) when any `dept_doc_type` references it
  or any `document` references it; otherwise the workflow and its steps are removed in one
  `em.transactional()`. Rationale: a non-nullable FK means a bare delete would 500 on a
  constraint violation — we turn that into a clear 400 and only hard-delete truly orphan
  workflows.
- **Step edit/delete is guarded by in-flight documents.** `PATCH /workflows/steps/:id` and
  `DELETE /workflows/steps/:id` are rejected when the parent workflow has any document in
  `SUBMITTED` or `IN_APPROVAL`. Rationale: those documents are actively routing through the
  live step set; mutating it mid-flight would corrupt their approval chain. When no document
  is in-flight, editing/deleting is safe (future submissions re-read the steps). Editing
  preserves the existing `amountMin ≤ amountMax` check and the per-workflow unique `stepNo`.
- **Deactivate instead of delete as the "retire" path.** Because deleting a workflow that
  any document ever used is blocked by the FK guard, toggling `isActive` off is the intended
  way to retire a workflow that has history — it drops out of new-document selection while
  preserving routing history. The UI surfaces this.
- **Reuse the step form for edit.** The step create page becomes create-or-edit: with a
  `:stepId` it loads the step's current values and submits to the update action; without it,
  it creates as today. Keeps one validated form (one Zod schema) rather than duplicating.
- **Confirm destructive actions client-side only as UX.** Delete workflow / delete step use
  a PrimeVue confirm dialog; the server remains the authority and re-checks every guard.

## Risks / Trade-offs

- [Editing `stepNo` collides with an existing step] → The `workflow_step` unique
  `(workflow, stepNo)` constraint plus a pre-check return a clear 400 instead of a DB error.
- [Race: a document is submitted between the in-flight check and the step mutation] → Perform
  the guard read and the mutation in a single `em.transactional()` so the check and write are
  one unit; a document submitted after commit re-reads the new step set anyway.
- [User expects delete to always work] → When blocked, the error names the reason (mapping
  vs. in-flight document) and the UI points to deactivate as the alternative.

## Migration Plan

Additive: new endpoints, DTOs, service methods, and UI. No schema/migration change (existing
tables, no new columns). Rollback = revert the commit; existing create/add-step flows are
untouched.

## Open Questions

- Should deleting the last remaining step of an otherwise-used workflow be treated specially?
  Default: no — step delete is governed solely by the in-flight guard; an empty workflow is a
  valid (if non-routing) state, consistent with today's "workflow with no steps" list case.
