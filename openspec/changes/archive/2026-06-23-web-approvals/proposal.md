## Why

`web-documents` lets a requester create and submit a document, but submit only leaves it
`SUBMITTED` — nothing routes it, and there's no way for an approver to see or act on it from
the browser. This change closes the create → approve → settle loop: documents auto-route into
approval on submit, approvers get an inbox of what's awaiting them, and they act
(approve/reject/return) with a remark — honoring no-self-approval (invariant 8). The backend
has `start` / `act` / `approval-log`, but no "pending my approval" read, so this change adds
that and an auto-start so inboxes actually populate.

## What Changes

- **New capability `web-approvals`** — the approver inbox + action UI in the Vue shell.
- **Backend (approval-workflow delta, minimal)**:
  - `GET /approvals/pending` (`DOC_APPROVE`) → the active company's `IN_APPROVAL` documents
    where the signed-in user is an eligible actor for the current step (principal or active
    one-hop delegate) **and is not the creator** — the inbox query mirrors `act`'s
    authorization exactly so nothing shows that the user can't actually act on.
  - **Auto-start routing on submit**: when a submitted document has a mapped workflow with
    applicable steps, routing begins automatically (an `approval-workflow` listener on a
    `document.submitted` event calls the existing `start`), moving it to `IN_APPROVAL`
    without a manual step. Decoupled via an event so document-engine doesn't depend on
    approval-workflow (build-order direction preserved). If routing can't start (no steps),
    the document stays `SUBMITTED` and is recoverable.
- **Approval inbox** (`DOC_APPROVE`): a list of documents awaiting the user (doc no, type,
  requester, base total, current step, age/SLA), click through to the document.
- **Act on a document** (`DOC_APPROVE`): Approve / Reject / Return buttons with a remark,
  shown on the document detail when the document is `IN_APPROVAL`, the user holds
  `DOC_APPROVE`, **and the user is not its creator** (self-approval affordance hidden;
  server still blocks). Posting drives the existing `POST /documents/:id/actions`; the detail
  and inbox refresh to the new status.
- **Shell integration**: an "Approvals" nav entry (gated by `DOC_APPROVE`); a typed
  `api/approvals.ts` + a small Pinia store; the approval timeline already on the detail shows
  the resulting log row.
- **Tests**: backend tests for the inbox read (eligible/excludes-self/excludes-not-in-approval)
  and auto-start on submit; frontend unit tests for the approvals store and the
  action-gating helper (including the no-self-approval rule).

## Capabilities

### New Capabilities
- `web-approvals`: the Vue approver inbox and approve/reject/return action UI,
  permission-gated and honoring no-self-approval.

### Modified Capabilities
- `approval-workflow`: adds a requester-facing... approver-facing **inbox read**
  (`GET /approvals/pending`) and **auto-start of routing on submit** so submitted documents
  reach approvers' inboxes without a manual start. Existing requirements are unchanged.

## Impact

- **Affected**: `front-end/` (new view + action UI, store, api, router/nav) and
  `back/src/modules/approval/` (inbox service + controller + a `document.submitted` listener)
  with one event emission added in `back/src/modules/document/document-submit.service.ts`.
- **Invariants reflected**: 8 (no self-approval — enforced server-side in `act`, mirrored by
  hiding the affordance and excluding own docs from the inbox); 5 (gate by `DOC_APPROVE`);
  1 (inbox scoped to the active company); 4 (final approve runs the post-action settle —
  already implemented in `act`; this change just makes it reachable from the UI).
- **Consumes**: existing `POST /documents/:id/actions`, `GET /documents/:id`,
  `GET /documents/:id/approval-log`, plus the new `GET /approvals/pending`.
- **No schema change**; no new dependency.

## Out of Scope

- Workflow / step / delegation **configuration** UI — later `web-approval-config`.
- Bulk approve, comments threads, and email/push delivery of inbox items (in-app + the
  existing notification transports already cover persistence; UI for the bell is a later
  `web-notifications`).
- Parallel-approval coverage visualization beyond showing the current step — the engine
  handles `PARALLEL_ALL/ANY`; rich progress UI is a follow-up.
- Manual "send for approval" / re-route controls — auto-start covers the common path.
