## 1. Error envelope

- [x] 1.1 `back/src/common/errors/error-code.ts`: add `explained(key, params, message, status = 400, code?)` building the same Nest exception as `coded` and attaching enumerable `messageKey` / `params` (+ `code` when given); export `isExplained()`; header comment states key ≠ code
- [x] 1.2 `coded-exception.filter.ts`: copy `messageKey` and `params` onto the response body when the exception carries them; nothing else changes
- [x] 1.3 `coded-exception.filter.spec.ts`: keyed refusal carries `messageKey`, `params`, English `message` and its `code`; unkeyed refusal has neither field; `explained` + code carries both

## 2. Settle guard — raisable types, judged on the write

- [x] 2.1 `ref-chain.config.ts`: `reservingTypes()` = active + `requires_budget` + at least one active `dept_doc_type` row; `strandedReservingTypes()` returns the ids without a path; `assertNoReservingTypeStranded(em, companyId, before)` refuses only for `after − before`, via `explained('config.type.wouldStrand', { typeCode }, …)`; `assertReservationCanBeSettled` keeps its strictness, message becomes `explained('config.type.cannotSettle', { typeCode }, …)`
- [x] 2.2 `document-type.service.ts#update`: snapshot `strandedReservingTypes` before applying the dto; pass it to the guard after
- [x] 2.3 `ref-chain.service.ts#removePairing`: snapshot before `tem.remove`, pass to the guard after flush
- [x] 2.4 Tests (`ref-chain` / `document-type` specs): an unmapped budget-requiring type without a path does not block deactivating another type; a mapped, already-stranded type does not block an unrelated toggle; removing the last pairing on a path is still refused naming the stranded type; deactivating the only settling type is still refused; mapping a stranded type is still refused; the refusal body carries `messageKey` + `typeCode`

## 3. Keyed refusals in the configuration services

- [x] 3.1 `document-type.service.ts` (8 sites): `config.type.codeExists {typeCode}`, `config.type.categoryInactive {categoryCode}`, `config.type.voucherTypeExists {existingCode}`, `config.type.payeeNeedsVendor {typeCode}`, `config.type.stockNeedsWarehouse {typeCode}`, `config.type.accrualNeedsBudgetOrVendor {typeCode}`, `config.type.accrualMustSettle {typeCode}`, `config.notFound.type`
- [x] 3.2 `document-category.service.ts` (4): `config.notFound.category`, `config.category.codeExists {categoryCode}`, `config.category.inUse`
- [x] 3.3 `form-template.service.ts` (11): `config.form.notDraft {status}`, `config.form.unknownFieldType {fieldType}`, `config.form.dropdownNeedsOptions`, `config.form.optionsNotJson`, `config.form.optionsEmpty`, `config.form.notPublished {status}`, `config.notFound.template`, `config.notFound.field`
- [x] 3.4 `dept-doc-type.service.ts` (10): `config.mapping.templateOfOtherType`, `config.mapping.templateRetired`, `config.mapping.differentCompanies`, `config.mapping.duplicate`, `config.mapping.typeNotEnabled {typeCode}`, `config.notFound.department|type|template|mapping`
- [x] 3.5 `ref-chain.service.ts` (7): `config.pairing.selfChain`, `config.pairing.duplicate`, `config.pairing.departmentOtherCompany`, `config.notFound.pairing|department|type`
- [x] 3.6 `workflow-config.service.ts` (15): `config.step.amountOrder`, `config.step.duplicateNo {stepNo}`, `config.step.roleNotInCompany {field}`, `config.step.userNotInCompany {field}`, `config.step.noApprover {stepNo}`, `config.workflow.inUseByMapping`, `config.workflow.inUseByDocuments`, `config.notFound.workflow|step|delegation` (no "already cancelled" throw exists — cancel is idempotent)
- [x] 3.7 Every English `message` that printed a UUID is reworded to name the thing without the id; `params` never carries an id

## 4. Frontend

- [x] 4.1 `front-end/src/i18n/locales/{en,la,zh}/errors.ts` with `config.*` for every key in §3, registered in each locale index; a spec asserts la and zh carry every en key under `errors.config`
- [x] 4.2 `utils/apiError.ts#messageOf`: when `response.data.messageKey` is set and `i18n.global.te('errors.'+key)`, return `t('errors.'+key, params)`; else current behaviour; `apiError.spec.ts` covers known key, unknown key, no key, array message
- [x] 4.3 `DocTypesView.vue#toggleActive`: on a refused toggle re-read the type so the switch shows the stored value; spec: switch reverts and the toast text is the translated sentence when the locale is `la`
- [x] 4.5 `stores/docConfig.ts`: `run()` records a refused action in new `actionError`, not in `error` (which drives the page-load ErrorState); the 24 `fb.error(cfg.error)` sites in doc-config views read `actionError`; the toggle spec asserts the list stays on screen
- [x] 4.4 Smoke: `pnpm --filter front-end` typecheck + vitest green

## 5. Verify

- [x] 5.1 Backend vitest (`DB_PORT=5433 DB_NAME=erp_test`), frontend vitest, both typechecks
- [x] 5.2 On the local stack (HAL copy, `CLAIM_RECOVERY` still `requires_budget = true` and unmapped): toggling `REC` active/inactive succeeds; mapping `CLAIM_RECOVERY` to a department is refused with the Lao sentence naming `CLAIM_RECOVERY`; saving a step with no approver shows the Lao sentence with the step number
