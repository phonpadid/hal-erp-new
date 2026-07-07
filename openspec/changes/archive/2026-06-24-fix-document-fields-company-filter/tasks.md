## 1. Fix the company-scoped reads on mutation paths

- [x] 1.1 In `back/src/modules/document/document.service.ts`, change `setFieldValues` to obtain its EntityManager via `this.scope.forActiveCompany()` instead of `this.em.fork()`, so the `company` filter param is bound before `getWith` runs.
- [x] 1.2 Apply the same change to `setLines` (use `this.scope.forActiveCompany()`); confirm the `nativeDelete(DocumentLine, …)` and `writeLines` calls still operate on the scope-verified document.
- [x] 1.3 Leave the `FILTER_OFF` reads/writes on the child rows (`DocFieldValue`, `DocumentLine`) inside `writeFieldValues` / `writeLines` unchanged — they are keyed by the already-verified parent `document.id`.

## 2. Tests

- [x] 2.1 Unit test: `setFieldValues` on a document in the active company persists `doc_field_value` rows without throwing (regression for "No arguments provided for filter 'company'").
- [x] 2.2 Unit test: `setFieldValues` / `setLines` for a document `:id` belonging to another company throws `NotFoundException` (404) and writes no `doc_field_value` / `document_line` rows (invariant 1).
- [x] 2.3 Run the existing document module test suite to confirm no regressions (`get`, `setLines`, `createDraft`). All 19 document-module tests pass.

## 3. Verify

- [x] 3.1 Covered by the DB-backed regression test 2.1, which exercises the exact `setFieldValues → getWith → findOne(Document)` path from the original 500 stack trace and now succeeds. (Live HTTP `PUT /documents/:id/fields` left to the user, who has the running app + auth context.)
