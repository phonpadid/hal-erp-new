## 1. Schema + entity (default_gl_account)

- [x] 1.1 Add `default_gl_account varchar [null]` to `document_type` in
  `erp_approval_system.dbml` (next to `requires_item`)
- [x] 1.2 Add the nullable `defaultGlAccount` property to the `DocumentType` entity
- [x] 1.3 Generate a migration adding the nullable column

## 2. Document-type config surface (backend)

- [x] 2.1 Add optional `defaultGlAccount` (`@IsString`, max length) to `CreateDocumentTypeDto`
  and `UpdateDocumentTypeDto`
- [x] 2.2 Persist `defaultGlAccount` in the document-type create/update service
- [x] 2.3 Return `defaultGlAccount` from the creatable-types read (so the wizard can use it)
- [x] 2.4 Unit test: create/update round-trips `defaultGlAccount`; null when omitted

## 3. Item-less line resolution (document-engine)

- [x] 3.1 In `DocumentService.writeLines`, for an item-less line apply precedence: explicit
  `budgetId` → type `default_gl_account` → nothing (pass `docType` already available)
- [x] 3.2 When resolving from the type default on a `requires_budget` type, stamp
  `gl_account` from the default and resolve `budget_id` best-effort via the existing
  `(fiscal_year, department, gl_account)` resolver; leave budget unset (do NOT throw) when no
  active budget matches
- [x] 3.3 Keep the explicit-`budgetId` path taking precedence and stamping GL from the chosen
  budget; keep the item-backed path unchanged (still rejects when its GL resolves no budget)
- [x] 3.4 Unit tests: type default resolves an item-less line's budget + GL; explicit budget
  overrides the default; unresolved default leaves budget unset without throwing (and submit
  coverage still rejects a positive uncovered line); a type with no default is unchanged

## 4. Frontend document-type admin (web-doc-config)

- [x] 4.1 Add a `default_gl_account` field to the document-type create/edit form
- [x] 4.2 Update the shared doc-type Zod schema to include `defaultGlAccount` (optional string)
- [x] 4.3 Add the field to the frontend `DocTypeSummary` / `CreatableType` types as needed

## 5. Create wizard (web-documents)

- [x] 5.1 Pass the selected type's `defaultGlAccount` into `LineItemsEditor`
- [x] 5.2 For an item-less line, when `defaultGlAccount` matches a loaded budget, show that
  resolved budget read-only (reuse the item-line chip path) and hide the picker
- [x] 5.3 Update the client budget-coverage check so an item-less line whose type default
  resolves is not flagged; the picker/flag only apply when nothing resolves
- [x] 5.4 Keep the explicit picker as the fallback when there is no resolvable default and no
  chosen budget

## 6. i18n + verification

- [x] 6.1 Add any new en/la strings (e.g. the doc-type default-GL field label)
- [x] 6.2 Run `openspec validate --changes doc-type-default-gl --strict`
- [x] 6.3 Backend suites green (document-engine resolution, document-type config); migration
  applies cleanly and existing types read `defaultGlAccount = null`
- [x] 6.4 Frontend `vue-tsc` clean for the changed files _(component tests deferred: frontend vitest not installed in this env)_
