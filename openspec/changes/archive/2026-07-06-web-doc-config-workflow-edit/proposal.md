## Why

A `WORKFLOW_MANAGE` user can create workflows and add steps, but cannot edit or remove
anything afterward: no renaming a workflow, no activating/deactivating it, no deleting it,
and no editing or deleting a step once added. A mistake (wrong approver, wrong amount band,
a typo in the name, a workflow that should be retired) is permanent, which makes the
Configuration area unsafe to iterate on. This closes the CRUD gap so approval routing can
actually be maintained.

## What Changes

- **Edit a workflow** — a `WORKFLOW_MANAGE` user can change a workflow's `name`,
  `conditionJson` (amount band + job levels), and toggle its `isActive` state.
- **Delete a workflow** — allowed only when nothing depends on it: rejected when a
  `dept_doc_type` mapping references it, or any document references it (the `document`→
  `workflow` FK is non-nullable). On delete, its `workflow_step` rows are removed with it.
- **Edit a step** — change a step's approver (role or person), amount range, approval
  mode, SLA, step name, step number, and per-step condition, reusing the existing step
  validation (amount range, unique `stepNo`).
- **Delete a step** — remove a step from a workflow.
- **In-flight safety** — because routing reads `workflow_step` live at approval time,
  editing or deleting a step is rejected while the parent workflow has a document in a
  non-terminal state (`SUBMITTED` / `IN_APPROVAL`). Deactivating a workflow only removes
  it from selection for new documents and stays allowed. The append-only `approval_log`
  is untouched (it stores `stepNo` as an integer, not an FK), so approval history survives
  step deletion.
- Backend endpoints: `PATCH /workflows/:id`, `DELETE /workflows/:id`,
  `PATCH /workflows/steps/:id`, `DELETE /workflows/steps/:id`, all under the existing
  `WORKFLOW_MANAGE` guard and company scope.
- Frontend: edit/toggle/delete affordances on the Workflows list and the workflow detail
  view, an edit-step form (reusing the step form), and confirm dialogs for destructive
  actions, all gated by permission code (UX-only; server enforces).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-doc-config`: The "Workflow and Step Management" requirement extends from
  create-and-add-only to full lifecycle management — editing/deactivating/deleting a
  workflow and editing/deleting a step, with the in-flight and referential guards above.
- `approval-workflow`: Adds the backend rules for updating and deleting workflows and
  steps, including the referential-integrity and in-flight-document guards that protect
  active approval routing.

## Impact

- **Backend:** `back/src/modules/approval/approval-config.controller.ts` (new routes),
  `workflow-config.service.ts` (update/delete methods + guards),
  `dto/workflow.dto.ts` (`UpdateWorkflowDto`, `UpdateWorkflowStepDto`). Reads `dept_doc_type`
  and `document` to enforce guards. No new tables; no migration (mutating existing config
  tables; `approval_log` remains append-only).
- **Frontend:** `front-end/src/api/docConfig.ts` (update/delete calls),
  `stores/docConfig.ts` (actions), `views/admin/doc-config/WorkflowsView.vue` and
  `WorkflowDetailView.vue` (edit/toggle/delete UI), `WorkflowStepCreateView.vue` or a
  sibling for edit mode, i18n keys.
- **Invariants:** No budget/quota/ledger paths touched. Company isolation preserved (all
  operations resolve the active company and filter by it). `approval_log` stays
  append-only. Permission-code authorization unchanged (`WORKFLOW_MANAGE`).
