## Why

The Configuration → Workflows page (`/doc-config/workflows`) only lists workflows in a
table with each workflow's steps crammed into one-line chips, and the sole per-workflow
action is "Add step". There is no way to open a single workflow and read its full routing
configuration — the selection condition (amount band + job levels), and each step's
approver, amount range, approval mode, and SLA in a legible form. A `WORKFLOW_MANAGE` user
cannot audit or reason about how a document will route before wiring it into a mapping.

## What Changes

- Add a **workflow detail view** at a new route `/doc-config/workflows/:workflowId`,
  reachable by clicking a workflow row (or a "View" affordance) on the Workflows list.
- The detail view shows the workflow header (name, active state) and its **selection
  condition** — amount band and position/job levels — rendered in a readable summary.
- The detail view lists **steps in full** (not chips): step number, name, approver
  (role or specific person, resolved to a display label), amount range, approval mode,
  SLA hours, and any per-step condition.
- The existing "Add step" affordance moves onto the detail view; the list keeps its
  create-workflow action but delegates step management to the detail page.
- Empty/loading/error states for a workflow that has no steps or fails to load, and a
  not-found state for an unknown `:workflowId`.
- The route and its actions are gated by the `WORKFLOW_MANAGE` / `DOC_CONFIG_MANAGE`
  permission codes as a UX-only guard, consistent with the rest of the Configuration area.

No backend/API change is required: `GET /workflows` already returns each workflow with its
`steps[]` and the approver/user option data needed to resolve labels.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `web-doc-config`: The "Workflow and Step Management" requirement gains behavior for a
  dedicated per-workflow detail view — viewing a workflow's full step configuration and
  selection condition on its own directly-linkable route, and managing steps from there.

## Impact

- **Frontend only.** Affected code:
  - `front-end/src/router/index.ts` — new `doc-config-workflow-detail` route.
  - `front-end/src/views/admin/doc-config/WorkflowsView.vue` — row navigates to detail.
  - New `front-end/src/views/admin/doc-config/WorkflowDetailView.vue`.
  - `front-end/src/stores/docConfig.ts` — a `workflowById` getter / lookup (data already
    loaded via `loadAll()`; no new endpoint).
  - i18n message keys for the detail view labels.
- **No cross-capability invariant is affected.** This is a read-oriented UI addition; the
  server remains authoritative for company scope and permission enforcement (invariants 1
  and 6 unchanged). No budget/quota/ledger paths are touched.
