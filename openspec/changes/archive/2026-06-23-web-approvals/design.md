## Context

approval-workflow already has `ApproverResolverService.eligible(step, document)` (principal +
active one-hop delegate), `ApprovalRoutingService.start(documentId)` (SUBMITTED →
IN_APPROVAL, self-contained, emits `approval.step-assigned`) and `.act(documentId, dto)`
(eligibility + self-approval enforced, append-only `ApprovalLog`, runs the post-action settle
on final approve). `POST /documents/:id/start|actions` and `GET …/approval-log` exist. What's
missing for an inbox: a "documents I can act on" read, and something to move SUBMITTED
documents into routing — today `submit` stops at SUBMITTED. The Vue shell + `web-documents`
provide `can()`, the document detail, the documents store, and the typed api pattern.

## Goals / Non-Goals

**Goals**
- `GET /approvals/pending` returning the active company's actionable IN_APPROVAL documents for
  the signed-in user, using the SAME eligibility + self-approval rules as `act`.
- Auto-start routing on submit, decoupled via an event (no document→approval dependency).
- Vue: an inbox view + Approve/Reject/Return actions on the document detail, gated by
  `DOC_APPROVE` and hidden for the creator.
- Tests: inbox read (eligible / excludes-self / excludes-not-in-approval) + auto-start;
  frontend store + action-gating helper.

**Non-Goals**
- Workflow/delegation config UI, bulk actions, notification-bell UI, rich parallel-step
  progress, manual re-route.

## Decisions

### D1 — Backend inbox read (reuse the resolver, don't duplicate rules)
Add `ApprovalInboxService.pending()` (or a method on the routing service) +
`ApprovalController` `GET /approvals/pending` (`@RequirePermissions('DOC_APPROVE')`):
1. Load the active company's `Document`s with `status = IN_APPROVAL` (company scope via the
   active company; `filters: { company: false }` where scoped relations are touched, per the
   established pattern).
2. For each, load the current `WorkflowStep` (`workflow`, `currentStepNo`), call
   `resolver.eligible(step, doc)`, and keep the document iff the signed-in `userId` is an
   eligible actor **and** `userId !== doc.createdBy.id` (mirrors `act`'s self-approval block).
3. Return summaries: `{ id, docNo, documentType{code,name}, requesterName, baseTotalAmount,
   currentStepNo, submittedAt }`. *Alternative considered:* a single SQL join on
   `user_company_role` — rejected; the eligibility rules (delegation window, amount limit,
   parallel modes) already live in the resolver and must not be re-implemented and drift.
   N+1 over IN_APPROVAL docs is fine at this scale.

### D2 — Auto-start via a submit event (preserve build-order direction)
`DocumentSubmitService.submit` emits `document.submitted` (`{ documentId }`) **after** the
submit transaction commits (alongside its existing post-commit work), using the already-wired
`EventEmitter2` (the module emits approval/notification events today). approval-workflow adds
`@OnEvent('document.submitted')` → `routing.start(documentId)` in a try/catch: a document with
no applicable step stays SUBMITTED (start throws `BadRequest`, swallowed/logged). This keeps
document-engine free of an approval import (the listener lives in approval). Because the emit
is post-commit and `start` opens its own `em.fork()` transaction, a routing failure never
rolls back the submit. Existing submit unit tests construct the service without an emitter, so
they're unaffected.

### D3 — Frontend act + inbox
- `api/approvals.ts`: `pending()` → summaries; `act(id, { action, remark })` →
  `POST /documents/:id/actions`.
- `stores/approvals.ts` (Pinia): `pending`, `loading`, `error`; actions `loadPending`,
  `act(id, action, remark)` (capture server error, then refresh the inbox + current doc).
- `views/approvals/ApprovalInboxView.vue`: a DataTable of `pending` (doc no, type, requester,
  base total, step, submitted), row → document detail; empty state; error banner.
- Document detail (extend `web-documents`' `DocumentDetailView`): an action bar shown when
  `doc.status === 'IN_APPROVAL'` && `can('DOC_APPROVE')` && `doc.createdBy?.id !== auth.userId`
  — Approve / Reject / Return, each opening a small remark dialog (PrimeVue `Dialog` +
  `Textarea`), then `approvals.act(...)`. On success the detail reloads (status + log).

### D4 — No-self-approval mirror (invariant 8)
Two client mirrors, both backed by the server: the inbox excludes own documents (D1), and the
detail hides the action bar for the creator (D3). A pure helper
`canActOn(doc, userId, can)` → boolean centralizes the rule for testing.

### D5 — Routing & nav
Add `approvals` route (`meta.permission = 'DOC_APPROVE'`) under the shell and an "Approvals"
nav item gated by `can('DOC_APPROVE')`, beside "Documents".

### D6 — Tests
- Backend (DB-backed, reuse `seedDatabase`): submit a PR as `requester` → assert it becomes
  IN_APPROVAL (auto-start); `pending()` as `approver` includes it; `pending()` as the
  `requester`/creator excludes it; a non-IN_APPROVAL doc never appears. Drive eligibility
  through the seeded Approver-role step.
- Frontend (Vitest): approvals store (`loadPending` populates; `act` success refreshes; a
  rejected `act` surfaces the server message) and `canActOn` (creator → false; eligible
  non-creator with `DOC_APPROVE` → true; without permission → false).

## Risks / Trade-offs

- **Auto-start coupling via events** — if the emitter isn't wired in some runtime path, docs
  stay SUBMITTED (degrades safe, recoverable by a future manual start). Accepted; the app
  module wires `EventEmitterModule` globally.
- **N+1 in the inbox** — one step + eligibility resolution per IN_APPROVAL doc. Fine at demo
  scale; revisit with a denormalized assignee table if inbox size grows.
- **Estimating "age/SLA"** uses `submittedAt`; full SLA breach state is the scheduler's job
  (`SlaService`) and only surfaced as age here.

## Migration Plan

Backend: add the inbox service+route, the `document.submitted` emit, and the `@OnEvent`
listener; `pnpm --filter back build/test`. Frontend: add `api/approvals.ts`,
`stores/approvals.ts`, `ApprovalInboxView`, extend the detail with the action bar, router/nav,
and tests; `pnpm --filter front-end build/test`. Validate `openspec validate web-approvals
--type change --strict`. Rollback = revert the approval read + emit/listener and the
`front-end/` additions.

## Open Questions

- Should Return go to DRAFT (current `act` behavior) or a distinct RETURNED status? Default:
  keep the engine's current mapping (RETURN → DRAFT, releases holds) — no change here.
- Show SLA-overdue styling in the inbox now? Default: show plain age; defer breach styling to
  when `web-notifications` surfaces the scheduler's signals.
