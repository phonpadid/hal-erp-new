## 1. Schema

- [x] 1.1 DBML: add `submitted_signature_id uuid [ref: > user_signature.id, note: 'stamped at submit from app_user.current_signature_id, locked like exchange_rate — null for API-key submits and documents submitted before the column existed']` to `Table document` and the matching `Ref` line in `erp_approval_system.dbml`
- [x] 1.2 Entity: add `@Property({ fieldName: 'submitted_signature_id', type: 'uuid', nullable: true }) submittedSignatureId?: string` to `Document` in `back/src/modules/document/document.entities.ts` as a scalar FK (mirror `AppUser.currentSignatureId`'s comment on why it is not a relation)
- [x] 1.3 Migration `MigrationYYYYMMDD000000_DocumentSubmittedSignature.ts`: `alter table document add column submitted_signature_id uuid null` + FK to `user_signature(id)`; `down` drops it. Refresh the snapshot files the repo tracks

- [x] 1.4 Migration `Migration20260916000000`: recover `submitted_signature_id` for documents submitted before the column, from the proposer's latest `user_signature` uploaded at or before `submitted_at` only; `down` nulls stamps on documents older than the column migration
- [x] 1.5 `SignatureService.delete` also refuses a signature referenced by any `document.submitted_signature_id`; test through a real submit in `document-engine.service.spec.ts`

## 2. Backend — error code and `/auth/me`

- [x] 2.1 Add `SIGNATURE_REQUIRED: 'SIGNATURE_REQUIRED'` to `ErrorCode` in `back/src/common/errors/error-code.ts` with its one-line "reaction" in the header comment (the screen offers the profile page instead of an error)
- [x] 2.2 `RbacAuthService.identity()` (`back/src/modules/rbac/rbac-auth.service.ts`): add `hasSignature: !!user.currentSignatureId` to `UserIdentity` so `GET /auth/me` carries it; unit test both true and false

## 3. Backend — submit gate and stamp

- [x] 3.1 `DocumentSubmitService.submit()` (`back/src/modules/document/document-submit.service.ts`): after the DRAFT and derives-quantity guards, load `AppUser` for `RequestContext.userId()`; when `RequestContext.apiKeyId()` is unset and `currentSignatureId` is null, `throw coded(ErrorCode.SIGNATURE_REQUIRED, 'Upload your signature on the profile page before submitting')` — before any budget/quota reserve
- [x] 3.2 In the write transaction, stamp `doc.submittedSignatureId = signatureId ?? undefined` beside `exchangeRate` / `submittedAt`; never touched anywhere else
- [x] 3.3 Add `giveSignature(em, userId, filePath?)` helper to `back/src/test/` (insert `UserSignature`, point `currentSignatureId`) and reuse the private `giveSignature` in `approval-workflow.service.spec.ts` through it
- [x] 3.4 Tests in `document-engine.service.spec.ts` (or a new `submit-requires-signature.spec.ts`): person without signature → `SIGNATURE_REQUIRED`, no `budget_txn` row, status DRAFT; person with S1 → `submitted_signature_id = S1` and unchanged after replacing with S2; API-key context (`apiKeyId` set) → submit succeeds with null stamp
- [x] 3.5 Give fixture users a signature in every backend spec that submits a document (~19 files: grep `\.submit(` under `back/src/**/*.spec.ts`) and in the e2e suites' seeded users (`back/e2e/*.e2e.spec.ts`); run `vitest` with `DB_PORT=5433 DB_NAME=erp_test` until green

## 4. Backend — approve gate and `canAct` reason

- [x] 4.1 `ApprovalRoutingService.act()` (`back/src/modules/approval/approval-routing.service.ts`): move the acting-user load above the `approval_log` insert; when `dto.action === APPROVE && step.showSignatureOnPdf && !actingUser.currentSignatureId` throw `coded(ErrorCode.SIGNATURE_REQUIRED, ...)` after `assertSlipAttached`, before `tem.persist(ApprovalLog)`, inside the existing locked transaction
- [x] 4.2 `canAct()` → return `{ canAct: boolean; reason?: 'SIGNATURE_REQUIRED' }` (controller `GET /documents/:id/can-act` passes it through); reason set only when the user is otherwise eligible, the current recorded step is flagged on, and they have no signature
- [x] 4.3 Tests in `approval-workflow.service.spec.ts`: flip "approve without a signature still records" to expect `SIGNATURE_REQUIRED` with no new `approval_log` row and unchanged `current_step_no`; add flagged-off step approves with null `signature_id`; delegate without a signature refused although the delegator has one; reject/return without a signature still recorded; `canAct` reports the reason
- [x] 4.4 Give fixture approvers a signature in every backend spec that approves (~10 files: grep `ApproveAction.APPROVE` under `back/src/**/*.spec.ts`) and in `back/e2e`

## 5. Backend — PDF model and renderers

- [x] 5.1 `document-pdf.service.ts`: extend `SignatureBlock` with `heading: string`; compute it in the model builder — approved: the approver's `employee.position` in the document's company (department dropped on review), fallback `stepName`, then `ຂັ້ນທີ N`; pending: `stepName ?? ຂັ້ນທີ N`. Apply the same rule in the no-recorded-route fallback
- [x] 5.2 Add `proposerBlock: SignatureBlock | null` to `DocumentPdfModel`: heading `ຜູ້ສະເໜີ`, name via `nameOf(createdBy)`, `actedAt = submittedAt`, image from `submitted_signature_id` through `loadObject` (null-safe); null only when the document was never submitted
- [x] 5.3 Letter layout (pdfkit footer, section "(8)") and sheet layout (`document-sheet.renderer.ts#signatureRow`): prepend the proposer block, print `heading` instead of deriving labels; wrap the row at five columns of fixed equal width (`signature-rows.ts`) so ten signatures fit A4; keep the ruled-line placeholder for a missing image
- [x] 5.4 Tests: update heading assertions in `document-pdf.spec.ts`, `document-sheet-render.spec.ts`, `document-pdf-sheets.spec.ts`; add proposer-block cases (stamped S1 shown first, S1 kept after replacing with S2, null stamp → name over line); keep the "blocks ≤ steps" assertion on `signatureBlocks` only

## 6. Frontend — session context and API

- [x] 6.1 `front-end/src/stores/auth.ts`: add `hasSignature: boolean` to state, fill from `/auth/me`, add `setHasSignature(v)`; reset on logout
- [x] 6.2 `front-end/src/api/documents.ts#canAct`: return `{ canAct, reason? }`; `stores/documents.ts` keeps `canAct` and adds `canActReason`
- [x] 6.3 `SignaturePanel.vue`: after a successful upload call `auth.setHasSignature(true)`; when no signature is on file show a `<Message severity="info">` saying submit/approve need one (i18n `profile.signature.requiredFor`)
- [x] 6.4 i18n en/la/zh: `documents.signatureRequired.title`, `.body`, `.goToProfile`, and `profile.signature.requiredFor`

## 7. Frontend — gated affordances

- [x] 7.1 `MyDocumentsView.vue`: both "New document" buttons get `:disabled="!auth.hasSignature"`; render a `<Message severity="warn">` with `<RouterLink :to="{ name: 'profile' }">` beside them when disabled
- [x] 7.2 `CreateDocumentView.vue`: "Save & submit" disabled when `!auth.hasSignature` (Save draft untouched); show the same message on the review step; when `codeOf(e) === 'SIGNATURE_REQUIRED'` from `docs.submit`, show the message + link in the existing refusal panel and refresh `/auth/me`
- [x] 7.3 `DocumentDetailView.vue`: detail "Submit" disabled with message when `!auth.hasSignature`; "Approve" disabled with message when `!auth.hasSignature || docs.canActReason === 'SIGNATURE_REQUIRED'`, Reject/Return unchanged; `ReviewApprovalDialog.vue` handles `approvals.errorCode === 'SIGNATURE_REQUIRED'` by showing the message + link
- [x] 7.4 Approvals inbox (`views/approvals/*`): any inline Approve affordance follows the same disabled rule
- [x] 7.5 Vitest specs beside the views: disabled states with `hasSignature: false`, enabled after `setHasSignature(true)`, Reject/Return still enabled, coded refusal renders the profile link (mirror `document-detail-slips.spec.ts` style)

## 8. Verification and rollout

- [x] 8.1 Run backend `vitest` (`nvm use 22.19.0`, `DB_PORT=5433 DB_NAME=erp_test`) and frontend `vitest`; run `back/e2e` Playwright suites via the dev-stack skill — unit suites green (back 2378 / front 1345); the e2e API suite needs the sandbox admin credentials (`BOOTSTRAP_USERNAME`/`BOOTSTRAP_PASSWORD`) and was left for the user to run
- [x] 8.2 Manual check on the local stack: user without signature sees disabled New document / Approve with the profile link; upload at `/new/profile`; buttons enable without reload; submit and approve; export PDF shows ຜູ້ສະເໜີ block first, position headings, and a long route wrapping to a second row of five
- [x] 8.3 Confirm the mobile app (`app/`) surfaces the `SIGNATURE_REQUIRED` message text on approve and submit (no UI work; message must read sensibly)
- [x] 8.4 Prepare the user announcement: after release, submitting and approving need a signature uploaded at `/new/profile` (70 of 89 accounts affected on production as of 2026-09-15)
