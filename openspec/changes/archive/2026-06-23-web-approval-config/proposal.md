## Why

Approvers go on leave; their pending approvals need to flow to a delegate. The engine already
honors active delegations at act time (one-hop, no chaining — invariant 8), but the only way to
create one is the raw `POST /workflows/delegations`, and there's no way to *see* or *revoke* them.
This change adds the delegation admin — the last backend capability without a UI — so an admin can
set up and end delegations without API calls or re-seeding.

## What Changes

- **New capability `web-approval-config`** — the delegation admin in the Vue shell.
- **Backend (approval-workflow delta)** — `WORKFLOW_MANAGE`, active-company scoped:
  - `GET /workflows/delegations` → the active company's delegations (delegator, delegate,
    document type, amount limit, dates, status).
  - `POST /workflows/delegations/:id/cancel` → soft-cancel a delegation (status → `CANCELLED`),
    so the resolver (which honors only `ACTIVE`) stops applying it; history is preserved.
- **Delegations** (`WORKFLOW_MANAGE`): list active and past delegations, create one (delegator →
  delegate, optional document type and amount limit, validity window, reason), and cancel an
  active one.
- **Shell integration**: a "Delegations" nav entry (gated by `WORKFLOW_MANAGE`); a typed
  `api/approvalConfig.ts` + a Pinia store; the create form uses `@primevue/forms` + `zodResolver`
  with a schema shared in `@erp/shared`. Amount limit is a decimal string.
- **Tests**: backend tests for the list + cancel reads (and active-company scope); frontend unit
  tests for the store and the shared schema.

## Capabilities

### New Capabilities
- `web-approval-config`: the Vue delegation admin — list, create, and cancel approval
  delegations, permission-gated and company-scoped.

### Modified Capabilities
- `approval-workflow`: adds delegation **listing** and **revocation** (soft-cancel),
  complementing the existing create. The one-hop / no-chaining and self-approval rules are
  unchanged — they remain enforced by the resolver at act time.

## Impact

- **Affected**: `front-end/` (view, store, api, router/nav), `back/src/modules/approval/`
  (list + cancel on the workflow-config service/controller), and `shared/` (delegation Zod
  schema), with tests.
- **Invariants reflected**: 8 (delegation is one-hop and never chained — enforced by the resolver;
  this UI only sets up/ends delegations, it doesn't bypass that); 5 (gated by `WORKFLOW_MANAGE`;
  server enforces); 1 (delegations scoped to the active company).
- **Consumes**: existing `POST /workflows/delegations`, plus the new list + cancel. The
  delegator/delegate pickers reuse `GET /rbac/users` and the document-type picker reuses
  `GET /document-config/document-types` (admin holds those codes).
- **No schema change**; no new dependency.

## Out of Scope

- A self-service "delegate my approvals" view for non-admins (`WORKFLOW_MANAGE` only here).
- Editing a delegation in place (cancel + recreate; preserves the audit trail).
- Reassigning already-logged approval actions — delegation only affects future routing.
- Multi-hop / chained delegation — explicitly forbidden by invariant 8.
