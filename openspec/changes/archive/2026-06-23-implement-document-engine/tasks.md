## 1. Module scaffolding & DTOs

- [x] 1.1 Create `DocumentEngineModule` (`MikroOrmModule.forFeature` for the 9 document entities; import `MultiCompanyModule`, `MultiCurrencyModule`, `MasterDataModule`, `BudgetControlModule`, `QuotaManagementModule`; provide `CompanyScopeService`); register in `AppModule`.
- [x] 1.2 Add permission-code constants `DOC_CONFIG_MANAGE`, `DOC_VIEW`, `DOC_CREATE`, `DOC_SUBMIT`, `DOC_CANCEL` in a module `permissions.ts`.
- [x] 1.3 Add class-validator DTOs: document-type create/update; form-template create + form-field create; dept-doc-type mapping; create-document (`documentTypeId`, `currency?`, `vendorId?`, `relatedEmployeeId?`, `refDocumentId?`, lines[], fieldValues[]); submit DTO (`quotaReservations?`).

## 2. Configuration

- [x] 2.1 `DocumentTypeService` (global master, `DOC_CONFIG_MANAGE`): CRUD `document_type` with `requires_budget` / `requires_quota` / `post_action`.
- [x] 2.2 `FormTemplateService`: create template (new `version`), add `form_field`s, publish; documents pin their `form_template_id` (versioned forms).
- [x] 2.3 `DeptDocTypeService`: map (department, document_type) → form_template + workflow (company-scoped); unique per department+type.
- [x] 2.4 Config controllers guarded by `DOC_CONFIG_MANAGE`, `ParseUUIDPipe` on ids.

## 3. Numbering

- [x] 3.1 `NumberingService.next(companyId, documentTypeId, year)`: in `inTransaction`, `lockForUpdate(doc_running_number, {company, documentType, year})`, create-if-absent (derive `prefix`), increment `current_no`, return formatted `doc_no`.

## 4. Document creation & content

- [x] 4.1 `DocumentService.createDraft(dto)`: resolve active `dept_doc_type` for (active department, type) → pin `form_template` + `workflow`; issue `doc_no` via `NumberingService`; set company/createdBy from context, `ref_document_id`/vendor/relatedEmployee/currency; status DRAFT.
- [x] 4.2 Field values + lines: upsert `doc_field_value` by `form_field_id`; create `document_line` rows (item GL default via `ItemService.defaultGlAccountFor` when `gl_account` absent).
- [x] 4.3 `DocumentController`: create / get / list (company-scoped, `DOC_VIEW`/`DOC_CREATE`); set-fields / set-lines endpoints; `ParseUUIDPipe`.

## 5. Submit (the integration)

- [x] 5.1 `DocumentSubmitService.submit(documentId, { quotaReservations? })` in one `inTransaction`: reject if status ≠ DRAFT; validate required `form_field`s have values.
- [x] 5.2 Lock FX: `ExchangeRateService.convert` at submit date for header (`base_total_amount`) and each line (`base_line_amount`); stamp `exchange_rate`; identity rate when currency == base.
- [x] 5.3 Period + enablement: `FiscalYearService.assertOpenPeriod` (when `requires_budget`); `VendorService.assertVendorEnabled` / `ItemService.assertItemEnabled` for the active company.
- [x] 5.4 Config-driven holds (invariant 7): if `requires_budget`, `BudgetLedgerService.reserve` per line (budgetId + base_line_amount); if `requires_quota`, `QuotaUsageService.reserve` per `quotaReservations` (reject if flag set but none supplied). Then DRAFT → SUBMITTED + `submitted_at`.
- [x] 5.5 `cancel(documentId)` (`DOC_CANCEL`) + reusable `releaseDocumentHolds` (budget + quota `releaseAll`); export `releaseDocumentHolds` for approval-workflow's reject path. Submit/cancel controller endpoints.

## 6. Attachments

- [x] 6.1 `AttachmentService.register(documentId, { fileName, filePath, fileSizeKb?, mimeType? })` storing metadata only (bytes in S3/MinIO); endpoint guarded by `DOC_CREATE`.

## 7. Tests

- [x] 7.1 Numbering concurrency: two concurrent creates in one company-year get unique sequential `doc_no` (uses `lockForUpdate`).
- [x] 7.2 Config-driven: a `requires_budget=false, requires_quota=false` type submit creates no `budget_txn` / `quota_usage` and reaches SUBMITTED.
- [x] 7.3 Multi-line budget: a `requires_budget` document with two lines on two budgets reserves once per budget at the line's base amount.
- [x] 7.4 Locked FX: submit stamps `exchange_rate` + `base_total_amount` from the submit-date rate; later rate change doesn't move them.
- [x] 7.5 Validation/guards: missing required field rejects submit (stays DRAFT); submit into a CLOSED period rejects; a not-enabled vendor/item rejects.
- [x] 7.6 Cancel releases holds: a submitted budget+quota document, on cancel, has all reservations released (RELEASE rows; outstanding 0).
- [x] 7.7 Reference chain + versioned form: `ref_document_id` is set; a document keeps its `form_template_id` after a new version is published.

## 8. Verify

- [x] 8.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 8.2 Run `openspec validate implement-document-engine --strict`.
