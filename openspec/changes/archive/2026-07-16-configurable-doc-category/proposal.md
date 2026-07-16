## Why

Document-type categories (`PROCUREMENT`, `FINANCE`, `HR`, `ADMIN`, `IT`) are hardcoded as a
`doc_category` enum duplicated across five layers — the shared Zod constant, the backend enum,
the entity `@Enum`, the DTO `@IsEnum`, and a Postgres CHECK constraint. This forces a code change
+ migration + deploy to add or rename a category, and it forces every company in the group to
share one fixed list. That contradicts the platform's "configuration over code" principle and the
company-isolation invariant: different companies legitimately have different departmental
structures (one may need `LEGAL`, another `MARKETING`, and may not use `IT` at all).

## What Changes

- Introduce a company-scoped `document_category` configuration table (config, not enum), so a
  `DOC_CONFIG_MANAGE` user can create, rename, activate, and deactivate categories per company.
- `document_type.category` stays a text **code** but is no longer pinned to the `doc_category`
  enum: it is validated on write against the active company's `document_category` rows — the same
  code-reference pattern `default_gl_account` already uses (a GL code, not a hard FK). The frontend
  sources category options from an endpoint instead of the static `DOC_CATEGORIES` constant.
- Categories are soft-deleted (`is_active`) and code is immutable; a category referenced by any
  document type cannot be hard-deleted, only deactivated.
- Migration seeds the five current categories for every existing company and drops the CHECK
  constraint on `document_type.category`; no column swap or per-type backfill is needed because
  the stored category codes already match the seeded codes.

## Capabilities

### New Capabilities
<!-- none — category management is an extension of existing document-config capabilities -->

### Modified Capabilities
- `document-engine`: Document-type category becomes a company-scoped `document_category`
  configuration entity; `document_type.category` keeps its text code but is validated against that
  entity instead of the fixed `doc_category` enum; adds category CRUD
  (create/rename/activate/deactivate) with same-company and immutable-code rules.
- `web-doc-config`: The Configuration area gains a Categories management surface; the document-type
  create/filter forms source category options from the active company's categories endpoint
  instead of a hardcoded list.

## Impact

- **Data model / DBML**: new `document_category` table; `document_type.category` stays a text code
  (no longer enum-typed); `Enum doc_category` removed from `erp_approval_system.dbml`.
- **Backend** (`document` module): new `DocumentCategory` entity, category service + controller
  guarded by `DOC_CONFIG_MANAGE`, company scope; `config.dto.ts` and `document-type.service.ts`
  validate the category code against `document_category` instead of the enum; new migration
  (create table, seed per company, drop CHECK). `DocCategory` in `common/enums/index.ts` is kept
  only as the canonical seed set (no longer a validation constraint).
- **Shared** (`@erp/shared`): remove `DOC_CATEGORIES` const and the `z.enum(DOC_CATEGORIES)`;
  document-type schema uses `category: z.string().min(1)`; add `documentCategorySchema`.
- **Frontend** (`web-doc-config`): `DocTypesView.vue` fetches category options via the doc-config
  store; new Categories admin view/dialog; category filter and form Select bind to fetched options.
- **Invariants**: preserves company isolation (invariant 1) and configuration-over-code
  (invariant 7). No budget/quota/ledger paths touched. Existing `category` code values are kept
  as-is, so no document type loses its classification.
