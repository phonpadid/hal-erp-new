## Context

Document detail's timeline is built purely from `approval_log`
([DocumentDetailView.vue](../../front-end/src/views/documents/DocumentDetailView.vue) →
`timelineEvents` from `docs.approvalLog`), so it only shows completed actions. There is no
read that answers "who is this document waiting on?"

The building blocks already exist server-side:
- [`WorkflowStepResolver.applicableSteps(document)`](../../back/src/modules/approval/workflow-step.resolver.ts)
  returns the engaged steps in order, filtered by amount band and requester job level.
- [`ApproverResolverService.eligible(step, document)`](../../back/src/modules/approval/approver-resolver.service.ts)
  returns the eligible actors of a step — the targeted user, or the holders of the targeted
  role (via `user_company_role`, validity-dated), plus active one-hop delegates (invariant 8).
- The document carries `current_step_no` (the active step for SEQUENTIAL flows).

Neither resolver is exposed over HTTP today; they run inside submit/act. Existing endpoints
(`GET approval-log`, `GET can-act`, `GET pending`) don't cover "the current step's approvers
for document X".

Constraints: company isolation (invariant 1), authorize on permission codes (invariant 6),
read-only (no change to who can act or to invariant 8), and a visibility rule tighter than
plain `DOC_VIEW` — only participants should see the approver names.

## Goals / Non-Goals

**Goals:**
- Expose the current step's pending approvers for an `IN_APPROVAL` document: step no/name,
  `approve_mode`, and each eligible actor (user id + display name; `delegatedFrom` when a
  delegate). For a role-targeted step, include the role name plus its eligible holders.
- Restrict the read to participants: the document creator or an eligible approver in any
  applicable step; base `DOC_VIEW` + company scope still apply.
- Reflect the same engagement rules the router uses, and one-hop delegation, so the surfaced
  set matches who can actually act now.
- Render a pending entry in the detail timeline after the history.

**Non-Goals:**
- Changing who can act, the approval decision, escalation, or SLA logic.
- Predicting *future* steps beyond the current one (a "remaining path" preview is a follow-up).
- Exposing approver identities to non-participants or across companies.
- Any data-model change.

## Decisions

**D1 — A dedicated read endpoint composing the two existing resolvers.**
Add `GET /documents/:id/pending-approvers` (or an approval-module route keyed by documentId)
that: loads the company-scoped document; if not `IN_APPROVAL`, returns an empty/`pending: null`
payload; else finds the applicable step whose `stepNo === current_step_no`, calls
`ApproverResolverService.eligible(step, document)`, and projects the result. Rejected
alternative: inlining the resolvers in the frontend — impossible (needs role/delegation data)
and would duplicate routing rules. Reusing the resolvers keeps "who can act" and "who is shown"
from drifting.

**D2 — Participant-scoped visibility, not plain `DOC_VIEW`.**
`DOC_VIEW` + company scope is the floor, but the read additionally requires the caller to be a
participant: `document.created_by === caller` OR the caller appears among the eligible actors
of any applicable step (principals, via `ApproverResolverService.principals`). This matches the
chosen product rule ("requester + people in the workflow line") and avoids leaking approver
identities to unrelated `DOC_VIEW` users. A non-participant gets not-found.

**D3 — Role-targeted steps return role name + expanded holders.**
When `step.approver_role` is set, the payload carries `{ roleName, mode, approvers: [...] }`
where `approvers` is the expanded, delegation-aware holder list. When `step.approver_user` is
set, `roleName` is null and `approvers` is the single targeted user (+ delegate if any). This
is the chosen display option and lets the UI show both the role label and the concrete people.

**D4 — Display name from the existing identity fields.**
Each approver returns `{ userId, name, delegatedFrom? }`. `name` uses the same source the
history timeline already uses (`app_user.username`, optionally the employee full name if
cheaply available) so the pending and past entries read consistently. No new identity plumbing.

**D5 — Current step only.**
Scope the read to `current_step_no`. For PARALLEL_ALL/ANY the current step already yields all
concurrently-eligible actors from the resolver. A multi-step "path ahead" is explicitly a
non-goal to keep the surface small and the visibility rule simple.

## Risks / Trade-offs

- **Approver-name disclosure to the requester** → Accepted per product decision; bounded to
  participants and to the *current* step, company-scoped. No amounts or approver contact data
  beyond a display name.
- **Resolver reuse pulls role/delegation queries into a hot detail read** → Mitigation: the
  read runs once per detail open (not per line), forks its own EntityManager like other reads,
  and only resolves the single current step, not the whole path.
- **Shown set could differ from who truly acts if data changes between read and action** →
  Acceptable: it is advisory UX; the act endpoint remains authoritative. The read uses the same
  resolver, so any difference is a live data change, not a logic fork.
- **Empty approver list** (role has no current holders) → Return an empty `approvers` with the
  role name so the UI can show "no eligible approver — configuration gap" rather than nothing.

## Migration Plan

- Additive: one new read endpoint + one new frontend fetch and timeline entry. No migration,
  no change to existing routes. Deploy backend first, then frontend.
- Rollback: remove the frontend fetch/entry; the endpoint is inert if unused.

## Open Questions

- Route home: under `documents` (`GET /documents/:id/pending-approvers`) vs `approvals`
  (`GET /approvals/pending-approvers?documentId=`). Leaning to the `documents` path since it is
  document-scoped; confirm at apply time against route conventions.
- Whether to include `sla_hours`/due time on the pending entry (the detail already shows SLA
  separately). Deferred unless it reads better inline.
