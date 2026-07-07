## 1. Store and shared helpers

- [x] 1.1 Add a `workflowById(id)` getter (or lookup) to `front-end/src/stores/docConfig.ts` that resolves a workflow from the already-loaded `workflows` array.
- [x] 1.2 Extract the step-summary helpers currently in `WorkflowsView.vue` (`parseJobLevels`, and an approver-label resolver over `cfg.roles` / `cfg.users`) into a shared util so the list and detail view stay consistent.

## 2. Detail view

- [x] 2.1 Create `front-end/src/views/admin/doc-config/WorkflowDetailView.vue` reading `:workflowId` from the route and resolving the workflow via the store getter; call `cfg.loadAll()` on mount when the store is empty (deep-link support).
- [x] 2.2 Render the workflow header (name, active state) and the selection-condition summary (amount band + job levels) using theme tokens (light/dark safe).
- [x] 2.3 Render steps in a `DataTable`: step number, name, resolved approver (person username or role name, falling back to raw id), amount range, approval mode, SLA hours, and per-step condition.
- [x] 2.4 Add the "Add step" action (gated on `auth.can('WORKFLOW_MANAGE')`) that routes to `workflow-step-create` for this workflow.
- [x] 2.5 Add loading (`TableSkeleton`), error (`ErrorState` with retry), empty-steps (`EmptyState`), and not-found states; resolve not-found only after loading settles.

## 3. Routing and navigation

- [x] 3.1 Register route `doc-config/workflows/:workflowId` (name `doc-config-workflow-detail`) with `meta.permission: 'DOC_CONFIG_MANAGE'` in `front-end/src/router/index.ts`.
- [x] 3.2 In `WorkflowsView.vue`, make a workflow row navigate to the detail route (row click and/or a "View" button); move the per-row "Add step" affordance to the detail view.

## 4. i18n and tests

- [x] 4.1 Add the i18n message keys used by the detail view (header, columns, add-step, not-found) to the locale files.
- [x] 4.2 Add a `WorkflowDetailView.spec.ts` covering: render of a workflow with steps, deep-link load when store empty, unknown `:workflowId` → not-found, and add-step navigation.
- [x] 4.3 Update the views smoke test for the new navigation and route. (No `WorkflowsView.spec.ts` exists; the smoke suite is the list view's coverage.)
