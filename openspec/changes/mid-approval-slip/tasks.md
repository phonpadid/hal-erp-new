## 1. Schema and entities

- [x] 1.1 Add `Migration20260903000000`: `workflow_step.requires_payment_slip` boolean NOT NULL default false; `payment_attachment.document_id` uuid null; backfill `update payment_attachment pa set document_id = p.document_id from payment p where p.id = pa.payment_id`; set `document_id` NOT NULL; FK to `document` on update cascade; index on `document_id`; finally `alter column payment_id drop not null` — in that order, so the nullable payment only becomes possible after every row names its document
- [x] 1.2 Write the migration's `down`: delete `payment_attachment` rows with a null `payment_id` first (they cannot satisfy the restored constraint), then restore `payment_id` NOT NULL, drop the index, FK and `document_id`, and drop `requires_payment_slip`. Document the data loss in the migration's docblock
- [x] 1.3 Add `requiresPaymentSlip: boolean = false` to `WorkflowStep` in `back/src/modules/approval/approval.entities.ts`
- [x] 1.4 In `back/src/modules/payment-handoff/payment.entities.ts`, add `@ManyToOne(() => Document) document!` (indexed) to `PaymentAttachment` and make `payment?: Payment` nullable
- [x] 1.5 Run `pnpm --filter back migration:up` against an empty database and confirm the schema the migrations build matches the entities (CI's "Migrations build the schema from nothing" step)

## 2. Slips resolve by document, not by payment

- [x] 2.1 In `payment-attachment.service.ts`, replace the private `requirePayment(documentId)` with a company-scoped `requireDocument(documentId)`; keep the same `NotFoundException` shape for a document of another company
- [x] 2.2 `upload` writes `document` always and `payment` only when one exists for that document; the storage key is built from the document id rather than the payment id
- [x] 2.3 `list`, `downloadUrl` and `remove` query `payment_attachment` by `document`, so they answer for a document with no payment instead of 404-ing
- [x] 2.4 `remove` takes `LockMode.PESSIMISTIC_WRITE` on the document inside `em.transactional` before deleting the row, so a delete serialises against an approval (design: "Deleting Evidence Serialises Against Approval"); delete the stored object only after the transaction commits
- [x] 2.5 In `PaymentService.recordPayment`, keep already-attached slips attached: set `payment` on the document's existing null-payment slips inside the same transaction, and do not copy or re-create them
- [x] 2.6 `payment-handoff.service.ts`: `slipStatus` reports UPLOADED when the document has at least one `payment_attachment`, PENDING otherwise — no longer requiring a payment. Keep it a few queries for a whole page, not N reads
- [x] 2.7 Leave the route paths untouched (`/payments/:documentId/slips/...`) and leave the permission codes untouched: `PAYMENT_MANAGE` to upload, `PAYMENT_VIEW` to read, `PAYMENT_SLIP_DELETE` to delete

## 3. The approve-time gate

- [x] 3.1 Add `assertSlipAttached(document, step, tem)` — counts `payment_attachment` for the document and throws a coded error naming the missing evidence when the step's `requiresPaymentSlip` is true and the count is zero
- [x] 3.2 Call it in `approval-routing.service.ts` inside the existing `em.transactional`, under the existing `LockMode.PESSIMISTIC_WRITE` on the document, only when `dto.action === ApproveAction.APPROVE`, immediately after `this.postAction.assertApprovable(document, tem)` and before the `ApprovalLog` is created
- [x] 3.3 Confirm by reading the path that REJECT, RETURN and DELEGATE bypass the gate, and that the SLA escalation sweeper does not route through it

## 4. Step configuration carries the flag

- [x] 4.1 Add `requiresPaymentSlip?: boolean` to the create and update step DTOs with `@IsBoolean() @IsOptional()`, defaulting to false on create
- [x] 4.2 Persist and return the flag in `workflow-config.service.ts`, inside the existing single transaction and active-company resolution; do not add a new refusal for documents in flight
- [x] 4.3 Include the flag in the workflow step read surface so the detail view and the editor can show what was authored

## 5. Backend tests

- [x] 5.1 Gate unit tests: refused with no slip; approved with one; unaffected when the flag is false; a slip on a different document does not satisfy it; REJECT and RETURN succeed with no slip
- [x] 5.2 Assert the refusal leaves nothing behind — no `approval_log` row, `current_step_no` unchanged, no step closed or opened, no budget or quota release
- [x] 5.3 **Concurrency test:** two eligible approvers approve the same gated step concurrently with no slip — both refused, no `approval_log` row for either; and with one slip — exactly one approval recorded
- [x] 5.4 **Concurrency test:** a slip delete racing an approval of a gated step — either the approval is refused or it commits before the delete, never an approval recorded against an unmet requirement
- [x] 5.5 Slip service tests: upload/list/download/delete for a document with no payment; the pre-payment slip survives `recordPayment` and is not duplicated; another company's document is refused on every route
- [x] 5.6 `slipStatus` test: a document with a slip and no payment reads UPLOADED
- [x] 5.7 Step config tests: the flag round-trips through create, update and read; omitted on create stores false; another company's workflow is refused

## 6. Web: step editor

- [x] 6.1 Add the checkbox to `front-end/src/views/admin/doc-config/WorkflowStepCreateView.vue` via `<FormField>`, unchecked by default, with helper text saying the step cannot be approved until a slip is attached and that reject and return stay available
- [x] 6.2 Add `requiresPaymentSlip: z.boolean().default(false)` to the step's Zod schema so it mirrors the server DTO
- [x] 6.3 Show the requirement per step in the workflow detail view, beside approver, amount range, approval mode, SLA and escalation target
- [x] 6.4 Warn — without refusing the save — when the configured approver role or person holds no `PAYMENT_MANAGE`, following the existing "a configuration screen says when a setting cannot take effect" rule

## 7. Web: approval surface

- [x] 7.1 Surface the step's requirement and whether it is met on the approval action dialog; disable the approve control while unmet and state the reason next to it
- [x] 7.2 Offer the upload in place to an approver holding `PAYMENT_MANAGE`; re-check the requirement after a successful upload so approve becomes available without a reload
- [x] 7.3 Show the requirement and its state, with no upload control, to an approver lacking `PAYMENT_MANAGE`
- [x] 7.4 Keep reject and return enabled regardless of the requirement
- [x] 7.5 Render the server's coded refusal as the missing-evidence reason rather than a generic failure

## 8. Web: payments and documents

- [x] 8.1 `PaymentSlips.vue` reads and writes slips for a document with no payment; show the panel when the document carries a slip, or when its current step requires one; hide it when there is nothing to evidence and no requirement
- [x] 8.2 Update `api/payments.ts` and `stores/payments.ts` for the nullable payment
- [x] 8.3 Add i18n keys for the new labels, helper text and refusal reason in `la`, `en` and `zh`

## 9. Web tests

- [x] 9.1 Step editor: the checkbox round-trips; default unchecked; the no-`PAYMENT_MANAGE` warning renders and does not block saving
- [x] 9.2 Approval surface: approve disabled with the reason when unmet; enabled after an upload; no upload control without `PAYMENT_MANAGE`; reject and return stay enabled
- [x] 9.3 `PaymentSlips.vue`: panel shown for a slip with no payment; shown empty when the step requires one; hidden when neither applies
- [x] 9.4 Documents list: a document with a slip and no payment renders UPLOADED

## 10. Verify and roll out

- [x] 10.1 `pnpm --filter back test`, `pnpm --filter back typecheck:scripts`, `pnpm --filter back boot:check`, `pnpm --filter front-end run ci` — all green (run with `nvm use`; point the backend suite at the test database, not the live one)
- [x] 10.2 Deploy in order: migration, backend, frontend. The gate reads a column defaulting to false, so a backend deployed before any step is configured changes no behaviour
- [x] 10.3 Post-deploy, once: turn the flag on for HAL step 4, keyed by workflow name and step number rather than row id so it is safe to re-run — `update workflow_step ws set requires_payment_slip = true from workflow w, company c where w.id = ws.workflow_id and c.id = w.company_id and c.code = 'HAL' and w.name = 'ອະນຸມັດໃບເບີກຈ່າຍແລະອັບໂຫຼດສະລິບການໂອນ' and ws.step_no = 4;` (prior value backed up at `~/erp-backup-2026-09-01/csv/workflow_step__requires_payment_slip.csv`; expected row id `1c7648af-1bf1-427d-894c-b144f35ecba9`)
- [x] 10.4 Confirm on the live data that step 4 refuses an approval with no slip and accepts one after a slip is uploaded, then check the other 28 steps still approve unchanged
