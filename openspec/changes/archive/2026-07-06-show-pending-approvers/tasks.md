## 1. Backend — pending-step approver read

- [x] 1.1 Add a service method (approval module) `pendingApprovers(documentId)` that loads the
  company-scoped document; if not `IN_APPROVAL`, returns `{ pending: null }`.
- [x] 1.2 For an in-approval document, use `WorkflowStepResolver.applicableSteps(document)` to
  find the step whose `stepNo === document.currentStepNo`, then call
  `ApproverResolverService.eligible(step, document)` to get the eligible actors.
- [x] 1.3 Project the result to `{ pending: { stepNo, stepName, approveMode, roleName,
  approvers: [{ userId, name, delegatedFrom? }] } }` — `roleName` set only for a role-targeted
  step; `name` from `app_user.username`, matching the history timeline's source.
- [x] 1.4 Enforce participant visibility: allow only the document creator or an eligible actor
  (principal or delegate) of any applicable step; otherwise throw NotFound. Route gated by
  `DOC_VIEW`.
- [x] 1.5 Add the endpoint (`GET /documents/:id/pending-approvers`) with `@RequirePermissions`
  (`DOC_VIEW`) and `ParseUUIDPipe`; service already provided/exported by the module.

## 2. Backend — tests

- [x] 2.1 Test: creator of an `IN_APPROVAL` doc gets the current step's approvers (user id +
  name) with the right `stepNo`/`approveMode`.
- [x] 2.2 Test: a role-targeted step returns `roleName` plus all validity-dated holders.
- [x] 2.3 Test: an active one-hop delegate is included with `delegatedFrom` set; a second-hop
  delegation is not chained.
- [x] 2.4 Test: a `DOC_VIEW` user who is neither creator nor an eligible approver gets NotFound.
- [x] 2.5 Test: a `DRAFT`/terminal document returns `{ pending: null }` (no error).

## 3. Frontend — timeline pending entry

- [x] 3.1 Add an API call + types for the pending-approver read (`documentsApi.pendingApprovers`
  in `api/documents.ts`) returning the `{ pending }` shape; tolerates NotFound by returning
  `{ pending: null }`.
- [x] 3.2 In the documents store `loadDetail`, fetch pending approvers when the document is
  `IN_APPROVAL`; a NotFound/empty result (non-participant) yields `pendingApprovers = null`.
- [x] 3.3 Append a pending `TimelineEntry` after the history entries in `DocumentDetailView.vue`:
  current step (+ role name), and the approver(s) — role name + eligible people for a role step,
  the named user otherwise, annotating a delegate with who they act for.
- [x] 3.4 Add i18n strings (en + la) for the pending entry (title, step label, "on behalf of …",
  empty state); PrimeIcons `pi pi-hourglass`, `warn` severity token (no hardcoded colors).

## 4. Frontend — tests

- [x] 4.1 Test: `pendingApproverNames` lists role holders and annotates a delegate with its
  principal (the pure mapping the timeline entry renders); store fetches + exposes the pending
  step (role name + people) while `IN_APPROVAL`.
- [x] 4.2 Test: the store leaves `pendingApprovers` null (and skips the fetch) when the document
  is not in approval.

## 5. Verify end-to-end

- [x] 5.1 Verified via tests: creator of an `IN_APPROVAL` doc gets the current step + approvers;
  the store fetches and exposes the pending step; the timeline appends a pending entry. NOTE:
  not driven against a live running stack this session.
- [x] 5.2 Verified via test: a non-participant `DOC_VIEW` user is rejected (NotFound), so no
  approver identities are exposed; the store then leaves `pendingApprovers` null.
- [x] 5.3 `openspec validate show-pending-approvers` passes; backend `pending-approvers` 5/5;
  frontend touched specs 19/19; source files typecheck clean. Pre-existing, unrelated failures:
  `approval-inbox.spec.ts` (1) and `workflow-config-mutations.spec.ts` fail in isolation and
  touch no code from this change (DB-backed suite flakiness / prior breakage).
