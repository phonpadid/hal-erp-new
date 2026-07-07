## 1. Backend — DTOs and service

- [x] 1.1 Add `UpdateWorkflowDto` (`name?`, `conditionJson?`, `isActive?`) and `UpdateWorkflowStepDto` (all step fields optional) to `back/src/modules/approval/dto/workflow.dto.ts`.
- [x] 1.2 Add `updateWorkflow(id, dto)` to `WorkflowConfigService`: resolve within active company, apply name/conditionJson/isActive, flush.
- [x] 1.3 Add `deleteWorkflow(id)` to `WorkflowConfigService`: reject (`BadRequestException`) when a `dept_doc_type` or any `document` references it; else remove the workflow and its steps in one `em.transactional()`.
- [x] 1.4 Add `updateStep(id, dto)` and `deleteStep(id)`: reject when the parent workflow has a document in `SUBMITTED`/`IN_APPROVAL`; preserve `amountMin ≤ amountMax` and per-workflow unique `stepNo` on update; do both guard-read and write in one `em.transactional()`.

## 2. Backend — controller

- [x] 2.1 Add `PATCH /workflows/:id`, `DELETE /workflows/:id`, `PATCH /workflows/steps/:id`, `DELETE /workflows/steps/:id` to `approval-config.controller.ts` with `ParseUUIDPipe`, under the existing `WORKFLOW_MANAGE` guard.

## 3. Backend — tests

- [x] 3.1 Unit-test the guards: delete blocked by mapping, delete blocked by referencing document, orphan delete removes steps, step edit/delete blocked by in-flight document, step edit ok when none in-flight, company-scope rejection.

## 4. Frontend — API and store

- [x] 4.1 Add `updateWorkflow`, `deleteWorkflow`, `updateStep`, `deleteStep` to `front-end/src/api/docConfig.ts`.
- [x] 4.2 Add matching actions to `stores/docConfig.ts` (reload after each, surfacing `error`).
- [x] 4.3 Client edit forms reuse the existing shared `workflowSchema` / `workflowStepSchema` (validate full values); the server validates partials via `UpdateWorkflowDto` / `UpdateWorkflowStepDto`. No new shared schema was needed — reuse avoids client/server drift.

## 5. Frontend — UI

- [x] 5.1 On `WorkflowsView.vue`: add rename + toggle-active + delete affordances (delete via confirm dialog), keeping row navigation to detail.
- [x] 5.2 On `WorkflowDetailView.vue`: add edit-workflow (name/condition/active), delete-workflow, and per-step edit/delete actions (delete via confirm dialog); surface server rejection reasons via feedback.
- [x] 5.3 Make the step form create-or-edit: `WorkflowStepCreateView.vue` (or a sibling route) loads an existing step by id and submits to `updateStep`; without an id it creates as today.
- [x] 5.4 Add i18n keys (edit, delete, deactivate/activate, confirm messages, rejection surfacing) to en + la locales.

## 6. Frontend — tests

- [x] 6.1 Extend `WorkflowDetailView.spec.ts` (and/or a new spec) for edit/toggle/delete actions and confirm-dialog wiring; update the views smoke test if a new route is added.

## 7. Verify

- [x] 7.1 Backend: `nest build` clean; new service tests pass.
- [x] 7.2 Frontend: typecheck clean for changed files; new/updated specs pass; i18n parity holds.
