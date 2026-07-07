## 1. Backend: inbox read (approval-workflow)

- [x] 1.1 `ApprovalInboxService.pending()`: active company's `IN_APPROVAL` documents → for each load the current `WorkflowStep` and `resolver.eligible(step, doc)`; keep iff the signed-in `userId` is eligible AND `userId !== doc.createdBy.id`. Return `[{ id, docNo, documentType: { code, name }, requesterName, baseTotalAmount, currentStepNo, submittedAt }]`.
- [x] 1.2 `ApprovalController` `GET /approvals/pending` (`@RequirePermissions('DOC_APPROVE')`) → `pending()`. (Register the service in `ApprovalWorkflowModule`.)
- [x] 1.3 Backend test (DB-backed): reuse `seedDatabase`; with the seeded Approver step, a document IN_APPROVAL appears for the approver, is excluded for its creator, and a non-IN_APPROVAL document never appears.

## 2. Backend: auto-start routing on submit

- [x] 2.1 `DocumentSubmitService.submit`: after the submit transaction commits, emit `document.submitted` `{ documentId }` via the injected `EventEmitter2` (inject it if not already present).
- [x] 2.2 `approval-workflow` listener: `@OnEvent('document.submitted')` → `routing.start(documentId)` wrapped in try/catch (a doc with no applicable step stays `SUBMITTED`; log and swallow). Register the listener provider in `ApprovalWorkflowModule`.
- [x] 2.3 Backend test (DB-backed): submitting a seeded PR (with the mapped workflow) transitions it to `IN_APPROVAL` at step 1; a doc whose type has no applicable step stays `SUBMITTED`.

## 3. Frontend data layer

- [x] 3.1 `api/approvals.ts`: `pending()` (typed summaries) and `act(id, { action, remark })` → `POST /documents/:id/actions`.
- [x] 3.2 `stores/approvals.ts` (Pinia): `pending`, `loading`, `error`; actions `loadPending`, `act(id, action, remark)` (capture server error message; refresh inbox + current document on success).
- [x] 3.3 `utils/approval.ts`: pure `canActOn(doc, userId, can)` → `doc.status === 'IN_APPROVAL' && can('DOC_APPROVE') && doc.createdBy?.id !== userId`.

## 4. Views & shell

- [x] 4.1 `views/approvals/ApprovalInboxView.vue`: DataTable of `pending` (doc no, type, requester, base total, step, submitted), row → `document-detail`; empty state; error banner.
- [x] 4.2 Extend `DocumentDetailView`: an action bar (Approve / Reject / Return, each with a remark dialog) shown when `canActOn(doc, auth.userId, can)`; on success reload the document + log.
- [x] 4.3 Routing + nav: `approvals` route (`meta.permission='DOC_APPROVE'`); an "Approvals" nav item gated by `can('DOC_APPROVE')`.

## 5. Frontend tests

- [x] 5.1 Approvals store (mock `api`): `loadPending` populates; `act` success refreshes; a rejected `act` surfaces the server message.
- [x] 5.2 `canActOn`: creator → false; eligible non-creator with `DOC_APPROVE` → true; without `DOC_APPROVE` → false; non-IN_APPROVAL → false.

## 6. Verify

- [x] 6.1 `pnpm --filter back build` + `pnpm --filter back test` and `pnpm --filter front-end build` + `pnpm --filter front-end test` pass.
- [x] 6.2 Run `openspec validate web-approvals --type change --strict`.
