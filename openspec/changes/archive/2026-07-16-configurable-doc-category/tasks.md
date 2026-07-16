## 1. Data model & DBML

- [x] 1.1 Add `Table document_category` to `erp_approval_system.dbml` (id, company_id FK, code, name, is_active) with a `(company_id, code)` unique index, mirroring `document_type`.
- [x] 1.2 In the DBML, change `document_type.category doc_category` to a `category_id`-free `category` code note referencing `document_category`, and remove the `Enum doc_category` block. (Implemented as a text `category` code, not an FK — see design decision on the `default_gl_account` precedent.)

## 2. Backend — entity, DTO, service

- [x] 2.1 Create `DocumentCategory` entity in the `document` module (company-scoped, `code`/`name`/`isActive`, `(company_id, code)` unique).
- [x] 2.2 Keep `document_type.category` as a text code (drop the `@Enum`); keep `DocCategory` in `common/enums/index.ts` only as the canonical seed set (no longer a validation constraint).
- [x] 2.3 Add category DTOs (create: `code`+`name`; update: `name`+`isActive`, no `code`; list query with `includeInactive`) with class-validator; keep `config.dto.ts` document-type `category` as a validated `@IsString()` code.
- [x] 2.4 Add `DocumentCategoryService`: list (active-only by default, `includeInactive` flag), get, create (409 on duplicate code), update (immutable code), remove (reject hard-delete when a document type references the code); all methods company-scoped.
- [x] 2.5 In `document-type.service.ts`, validate the `category` code resolves to an **active** category of the active company before create (reject cross-company/inactive/unknown).
- [x] 2.6 Preserve read-path consumers of the category **code** (design decision 7): creatable-types read (`document.service.ts`) and document-summary report (`reporting.service.ts`) keep returning `category` as the code string; `MONEY_CATEGORIES` gating unchanged.

## 3. Backend — controller & guards

- [x] 3.1 Add category endpoints to `DocumentConfigController` (list/create/update/delete) guarded by `DOC_CONFIG_MANAGE`, `ParseUUIDPipe` on id params, company scope from JWT context.
- [x] 3.2 Wire `DocumentCategoryService` + `DocumentCategory` entity into the document module.

## 4. Migration & seed

- [x] 4.1 New migration: create `document_category` table + `(company_id, code)` unique index + company FK.
- [x] 4.2 Seed the 5 canonical categories (`PROCUREMENT`, `FINANCE`, `HR`, `ADMIN`, `IT`) for every `companies` row (idempotent via the unique constraint).
- [x] 4.3 Drop the CHECK constraint pinning `document_type.category` to the old enum values; `down()` restores it. No column swap or per-type backfill (stored codes already match seeded codes).
- [x] 4.4 Seed `document_category` rows per company in `seed-data.ts` so a fresh DB has categories.

## 5. Shared package

- [x] 5.1 Remove `DOC_CATEGORIES` const and the `z.enum(DOC_CATEGORIES)`; change document-type schema `category` → `z.string().min(1)`.
- [x] 5.2 Add `documentCategorySchema` (create) and `documentCategoryUpdateSchema` (edit) mirroring the backend DTOs; export them.

## 6. Frontend — categories admin

- [x] 6.1 Add `categories` state + `activeCategories` getter + fetch/create/update/remove actions to the doc-config store (active-only + `includeInactive` for the admin surface).
- [x] 6.2 Create `DocCategoriesView.vue` (list + create/edit dialog + inline active toggle + delete): `@primevue/forms` + `zodResolver(documentCategorySchema)`, code read-only on edit, theme tokens.
- [x] 6.3 Add the Categories route + sub-sidebar entry (`configCategories`) in the Configuration area, gated by `DOC_CONFIG_MANAGE`, plus i18n keys (en/la).

## 7. Frontend — document types

- [x] 7.1 In `DocTypesView.vue`, replace the `DOC_CATEGORIES` import with fetched category options from the store for the create form Select and the category filter; show the category name in the table.
- [x] 7.2 Default the create form `category` to the first active category code (not a hardcoded `'ADMIN'`); handle empty-categories state gracefully.

## 8. Tests

- [x] 8.1 Backend unit tests: `document-category.service.spec.ts` (company scope, immutable code, duplicate-code 409, hard-delete blocked when referenced, inactive-category rejected) + a bogus-category rejection in `doc-type-per-company.spec.ts`; seed `document_category` in the three specs that call the service create.
- [x] 8.2 Frontend test: updated `docConfig.spec.ts` (category is a free code; `documentCategories` in loadAll); existing `DocTypesView.spec.ts` filters still pass.
- [x] 8.3 Typecheck + suites green: shared build, backend document+reporting (138 pass), frontend affected specs (26 pass) + i18n parity; migration applied to dev DB and verified (CHECK dropped, table+index created, 5 categories seeded per company, 0 unresolved document types).
