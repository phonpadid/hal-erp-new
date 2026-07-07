## Why

When a document is `IN_APPROVAL`, the detail timeline shows only the approval **history**
(`approval_log` — actions already taken). It never shows who the document is waiting on, so a
requester has no way to see who to follow up with. The engine already resolves the eligible
approvers of a step (`ApproverResolverService.eligible`), but that result is used only
internally for authorization and routing — it is never exposed as a read.

## What Changes

- Add a read that returns the **pending step's approvers** for a document that is in approval:
  the current step's number/name, its `approve_mode`, and the list of eligible actors — each
  actor's user id + display name, and, for a delegate, who they act on behalf of. For a
  role-targeted step, also return the role name alongside the list of its eligible holders.
- Gate the read: base `DOC_VIEW` + company scope, and restrict visibility to **participants** —
  the document's creator (`created_by`) or a user who is an eligible approver in any applicable
  step of the document's workflow. Non-participants get not-found/forbidden.
- The read reflects delegation (one hop only, invariant 8) and the same step-engagement rules
  the router uses (amount band + requester job level), so the surfaced approvers match who can
  actually act now.
- Update the document detail timeline to append a **pending** entry after the history: the
  current step, its mode, and the approvers (role name + eligible people when role-targeted).
- No change to who can *act*; this is a read-only, informational surface. Reject/cancel/approve
  behavior is untouched.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `approval-workflow`: add a "Pending-Step Approver Read" requirement — a participant-scoped,
  read-only projection of the current step's eligible approvers (with delegation and role
  expansion), reusing the existing resolver and step-engagement rules.
- `web-documents`: the detail timeline shows a pending entry for the current step, listing the
  approver(s) the document is waiting on (role name + eligible holders when role-targeted).

## Impact

- **Backend:** new endpoint (e.g. `GET /documents/:id/pending-approvers` or an approval-module
  route) that composes `WorkflowStepResolver.applicableSteps` + `ApproverResolverService`
  against the document's `current_step_no`, returning a trimmed projection. A participant-
  visibility guard beyond the plain `DOC_VIEW` code.
- **Frontend:** `DocumentDetailView.vue` fetches the pending approvers when status is
  `IN_APPROVAL` and renders a pending timeline entry via `EventTimeline`; new i18n strings.
- **Invariants:** company isolation (invariant 1 — document already company-scoped) and
  authorize on codes (invariant 6). Read-only — the approval decision and no-self-approval
  (invariant 8) logic is unchanged; delegation shown is not chained.
- **No data-model change** — reads existing `workflow_step`, `approval_delegation`,
  `user_company_role`; no new tables/columns.
