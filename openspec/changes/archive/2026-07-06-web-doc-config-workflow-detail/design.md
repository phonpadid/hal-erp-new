## Context

The Configuration area's Workflows section (`WorkflowsView.vue`) renders `cfg.workflows`
in a `DataTable` where each workflow's `steps[]` is collapsed into `Chip` components via
`stepChipLabel()`. The only per-workflow action routes to `WorkflowStepCreateView` (the
dedicated add-step page). Workflow data — including full `steps[]`, `conditionJson`, and
the approver role/user options — is already loaded into the Pinia `docConfig` store by
`loadAll()` and served by `GET /workflows`. So the missing piece is purely a presentation
route: a place to read one workflow in full. This is frontend-only and touches no
budget/quota/ledger paths, so none of the core ERP invariants are in play beyond the
UX-only permission guard and company scoping already enforced server-side.

## Goals / Non-Goals

**Goals:**
- A directly-linkable route `/doc-config/workflows/:workflowId` showing one workflow's
  full configuration.
- Steps rendered legibly (table/definition list), with approver resolved to a display
  label (role name or person username), amount range, mode, SLA, and per-step condition.
- Selection condition (amount band + job levels) shown as a readable summary reusing the
  existing `parseJobLevels` logic.
- Step management ("Add step") available from the detail view.
- Consistent empty / loading / error / not-found states.

**Non-Goals:**
- No new or changed backend endpoint; no DBML/migration change.
- No step editing/reordering/deletion beyond what already exists (add step). Editing
  individual steps is out of scope for this change.
- No change to how workflows are created (the list keeps its create dialog).

## Decisions

- **Reuse the loaded store, don't add an endpoint.** The detail view resolves its workflow
  from `cfg.workflows` by `:workflowId` (add a `workflowById(id)` getter). If the store is
  empty (deep-link / refresh), it calls `cfg.loadAll()` on mount, mirroring how
  `WorkflowsView` and `WorkflowStepCreateView` already bootstrap. Alternative — a dedicated
  `GET /workflows/:id` — was rejected as unnecessary; the list payload already carries
  everything and keeps a single source of truth.
- **Steps as a `DataTable`, not chips.** The detail view's purpose is legibility, so each
  step gets its own row with explicit columns. Approver resolution: prefer
  `approverUserId` → look up in `cfg.users` (username); else `approverRoleId` → look up in
  `cfg.roles`; render the resolved label, falling back to the raw id if unresolved.
- **Navigation from the list.** The Workflows list row becomes clickable (row navigation
  to the detail route) and/or a "View" text button, alongside the existing action column.
  The "Add step" button moves to the detail view to keep the list uncluttered.
- **Not-found handling.** If no workflow matches `:workflowId` after load completes, show a
  not-found `EmptyState` with a link back to the list, rather than a hard error.
- **Permission gate.** The route carries `meta.permission: 'DOC_CONFIG_MANAGE'` like its
  siblings; the "Add step" affordance is additionally gated on `auth.can('WORKFLOW_MANAGE')`
  exactly as in the current list. Client guard is UX-only; server stays authoritative.

## Risks / Trade-offs

- [Deep-link before data loads] → On-mount `loadAll()` guard plus a `TableSkeleton` /
  loading state; resolve not-found only after loading settles, so a slow load doesn't
  flash the not-found state.
- [Approver id not resolvable to a label] → Fall back to showing the raw id so the step is
  never blank; this matches existing tolerant rendering in the list.
- [Duplicated step-summary logic] → `parseJobLevels` currently lives in `WorkflowsView`;
  extract shared helpers (e.g. a small `workflowStep` util) so the detail view and list
  stay consistent rather than drifting.

## Migration Plan

Additive frontend change: a new route and view plus a store getter. No data migration, no
rollback concern beyond reverting the frontend commit. Existing links to
`/doc-config/workflows` and the step-create route continue to work.

## Open Questions

- Should "Add step" remain reachable from the list row as well, or exclusively from the
  detail view? Default: move it to the detail view only, keeping the list focused on
  browsing. Revisit if `WORKFLOW_MANAGE` users prefer a shortcut.
