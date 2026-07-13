## 1. Schema + entity

- [x] 1.1 Add `company_id uuid [not null]` to `document_type` in `erp_approval_system.dbml`;
  replace the global `unique` on `code` with a `(company_id, code)` unique index
- [x] 1.2 Add a `@ManyToOne(() => Company) company` relation to `DocumentType` (kept on
  `BaseEntity`, NOT `CompanyScopedEntity` — the auto company filter would ripple to every
  documentType read app-wide); drop `unique` from `code` and add `@Unique({ properties:
  ['company', 'code'] })`
- [x] 1.3 Migration: add `company_id` nullable → backfill all rows to the earliest company
  (`company` by `created_at`) → set NOT NULL → drop the `code` unique, add `(company_id, code)`
  unique → deactivate `dept_doc_type` rows whose department company ≠ the type's company

## 2. Document-type service (company-scoped)

- [x] 2.1 Set `company` from `RequestContext.companyId()` on create (explicit, no injected scope)
- [x] 2.2 Scope `list` / `get` / `update` to the active company by an explicit `company` filter in
  the service; a type of another company is not found
- [x] 2.3 Enforce per-company `code` uniqueness on create/update (check within the active company)
- [x] 2.4 Unit tests: create stamps the active company; list/get return only the active company's
  types; the same `code` can exist in two companies; cross-company get is not found

## 3. Consistency guards

- [x] 3.1 In `DeptDocTypeService` create, reject mapping when the department's company ≠ the
  document type's company (400)
- [x] 3.2 In `DocumentService.createDraft`, resolve the document type through the company-scoped
  em so a type from another company is not-found
- [x] 3.3 Unit tests: mapping a cross-company type is rejected; creating a document with another
  company's type is rejected/not-found

## 4. Verification

- [x] 4.1 Run `openspec validate --changes doc-type-per-company --strict`
- [x] 4.2 Backend suites green (document-type config scoping, dept-mapping guard, creatable
  types); update existing doc-type/creatable/dept-mapping specs to seed a `company` on each
  `document_type`
- [x] 4.3 Migration applies cleanly on a seeded DB: existing types land on the primary company,
  `(company_id, code)` unique holds, and cross-company `dept_doc_type` rows are deactivated
- [x] 4.4 Frontend `vue-tsc` clean; the doc-type admin list shows only the active company's types
