## 1. Data model & migration

- [x] 1.1 Add `user_signature` table to `erp_approval_system.dbml` (id, user_id, file_path, mime_type, file_size_kb, uploaded_at) and columns `app_user.current_signature_id`, `approval_log.signature_id`, `workflow_step.show_signature_on_pdf boolean [default: true]`
- [x] 1.2 Create MikroORM entities: `UserSignature`; add `currentSignature` relation to the AppUser entity, `signature` relation to the `ApprovalLog` entity (both nullable), and `showSignatureOnPdf` to the WorkflowStep entity
- [x] 1.3 Generate and review the migration (additive/nullable; no backfill)

## 2. Signature storage backend (`document-signatures`)

- [x] 2.1 Signature module: DTO with image mime allow-list (png/jpeg) + max-size validation
- [x] 2.2 `POST /me/signature` (multipart) — resolve user from JWT, upload bytes to S3/MinIO reusing the attachment storage helper, insert a new immutable `user_signature` row, repoint `current_signature_id`
- [x] 2.3 `GET /me/signature` — return current signature (or empty state), self-scoped, no id in path
- [x] 2.4 Guard: signature-file delete is refused while any `approval_log` references it
- [x] 2.5 Unit tests: first upload, replace-keeps-old-file-immutable, non-image rejected, self-only access

## 3. Signature snapshot on approve (`approval-workflow`)

- [x] 3.1 In `approval-routing.service.ts` `act()` APPROVE branch, set `signature_id` on the created `ApprovalLog` from the acting user's `current_signature_id` (set at insert only — keep append-only)
- [x] 3.2 Ensure REJECT/RETURN/DELEGATE leave `signature_id` null; approve with no signature still succeeds
- [x] 3.3 Tests: approve stamps current signature, approve-without-signature succeeds with null, non-approve actions do not stamp

## 4. Per-step signature config (`workflow_step.show_signature_on_pdf`)

- [x] 4.1 Persist `show_signature_on_pdf` through the workflow-step config mutation/service and validate it as boolean
- [x] 4.2 Tests: flag saves/reads; routing/approval behavior unchanged when a step is flagged off

## 5. PDF export backend (`document-pdf-export`)

- [x] 5.1 Add PDF renderer dependency; create `DocumentPdfService` behind a stable interface (renderer swappable)
- [x] 5.2 Build the PDF template: header (doc_no/type/company/department/status), form field values, line items, approval trail
- [x] 5.3 Render one signature block per step flagged `show_signature_on_pdf` in `step_no` order, labelled by `step_name`; embed the stamped signature (fetch server-side by `approval_log.signature_id`), placeholder when null, empty box when the flagged step is not yet approved
- [x] 5.4 Watermark documents that are not COMPLETED (DRAFT/IN_APPROVAL)
- [x] 5.5 `GET /documents/:id/pdf` — reuse document-read guard + company scope; stream the PDF, do not persist
- [x] 5.6 Tests: authorized export, company-isolation denial, only-flagged-steps produce blocks, block count <= step count, signature-replaced-after-approval unchanged, null-signature renders, watermark on non-completed

## 6. Frontend — signature panel (`web-signature`)

- [x] 6.1 API client methods for `GET`/`POST /me/signature`
- [x] 6.2 Signature panel on the own-profile view: show current signature or empty state, upload/replace with client-side type+size validation mirroring the DTO
- [x] 6.3 Update the panel on success without full page reload
- [x] 6.4 Component tests: valid upload flow, client rejects invalid file, replace updates display

## 7. Frontend — step toggle & Export PDF action (`web-signature`)

- [x] 7.1 Add the `show_signature_on_pdf` toggle to the workflow-step config page, gated by the workflow-config permission code, saved through the existing step-config mutation
- [x] 7.2 API client method for `GET /documents/:id/pdf` (download)
- [x] 7.3 Export-PDF button on document detail: gated by read-permission code, progress indicator, error surface, triggers browser download
- [x] 7.4 i18n strings (en + la) for signature panel, step toggle, and export action
- [x] 7.5 Component tests: toggle persists, export triggers download, action hidden without permission, failure surfaces an error

## 8. Verification

- [x] 8.1 Run backend unit tests (signature, approval stamp, step-flag config, pdf export) and frontend component tests — all green (signature 8, approval-stamp 3, step-flag 1, pdf-model 5 backend; SignaturePanel 4, step-toggle 2, export-action 3 frontend). One pre-existing approval-inbox failure confirmed unrelated (fails without these changes).
- [x] 8.2 Covered at integration level by `document-pdf.spec.ts` (flag 2 of 3 steps → exactly 2 blocks; signature-replaced-after-approval still shows the original) and `approval-workflow.service.spec.ts` (APPROVE stamps the current signature). A live browser+MinIO+pdfkit run is not exercisable in this environment (optional deps absent); the pdfkit renderer is isolated behind `DocumentPdfService.toPdf` with the model fully tested.
