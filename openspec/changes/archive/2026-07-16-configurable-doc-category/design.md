## Context

Document-type categories are a fixed `doc_category` enum (`PROCUREMENT`, `FINANCE`, `HR`, `ADMIN`,
`IT`) duplicated across five layers: `shared/src/index.ts` (`DOC_CATEGORIES` const + `z.enum`),
`back/src/common/enums/index.ts` (`DocCategory`), the `document.entities.ts` `@Enum`, the
`config.dto.ts` `@IsEnum`, and a Postgres CHECK constraint from
`Migration20260617000000.ts`. Adding or renaming a category requires editing all five and
redeploying, and every company in the group is locked to the same list — at odds with invariant 7
(configuration over code) and invariant 1 (company isolation, since departmental taxonomies differ
per company). The document-type config service only persists `category`, but a few **read-path** consumers key
off the category **code** string: `CreateDocumentView.vue` gates the currency selector on
`MONEY_CATEGORIES = ['PROCUREMENT','FINANCE']`, `reporting.service.ts` groups the document-summary
report by category, and the creatable-types read (`document.service.ts` → `documents.ts`) returns
`category` as a string. None of these block moving to a config table: because seeded codes stay
canonical and immutable, every consumer keeps working as long as the read/report APIs keep
returning the category **code** (decision 7).

## Goals / Non-Goals

**Goals:**
- Company-scoped `document_category` table so each company defines its own categories.
- `DOC_CONFIG_MANAGE`-guarded CRUD (create / rename / activate / deactivate) reachable from the
  Configuration area.
- Stop pinning `document_type.category` to the `doc_category` enum; validate the category **code**
  against `document_category` instead (the `default_gl_account` code-reference pattern).
- Zero data loss and minimal churn: stored category codes already match the seeded codes, so no
  column swap or per-type backfill.
- Single source of truth for the client Select options (fetched from the API, not a static const).

**Non-Goals:**
- No category-driven business logic (workflow/budget behavior stays keyed off `document_type` flags).
- No group-wide shared category catalog; categories do not cross companies.
- No reordering / color / icon metadata on categories (can be a later change).
- No change to how documents themselves are created or approved.

## Decisions

**1. New table `document_category`, not a widened enum.**
Columns: `id (uuid pk)`, `company_id (fk companies, not null)`, `code (text, not null)`,
`name (text, not null)`, `is_active (bool, not null, default true)`, plus the project's standard
timestamps. Unique index on `(company_id, code)` — mirrors the `document_type` `(company_id, code)`
pattern so the same code can exist in different companies. Alternative considered: keep the enum and
just add values — rejected because it still needs a code change per value and can't vary per company.

**2. `document_type.category` stays a text **code**, validated against `document_category` — not a
hard FK.**
This mirrors `default_gl_account` (a GL *code* string validated in the service, not a DB FK) and
`post_action` (a string). On create, `DocumentTypeService.requireCategory(code)` asserts an
**active** `document_category` with that `(company_id, code)` exists, so a cross-company, inactive,
or unknown code is rejected with a clear error. Alternative considered — a `category_id` FK — was
rejected: it forces the seed plus ~25 spec files that build `DocumentType` to create/reference
category entities and needs a backfill migration, for referential integrity the codebase already
forgoes on `default_gl_account`. The code-string design keeps churn minimal (read paths, tests, and
`MONEY_CATEGORIES` gating are untouched) at the cost of no DB-level FK.

**3. Soft-delete only; block hard-delete when referenced.**
Deactivation sets `is_active=false` and drops the category from new-type option lists but leaves the
`category` code on existing document types intact (mirrors memory `doctype-list-active-only-default`:
config lists default to active-only, admin surfaces pass `includeInactive`). A hard delete is
rejected when any `document_type` references the code. This matches the invariant of not silently
breaking existing configured documents.

**4. Immutable `code`.**
`code` is set on create and never updated (parallels `document_type.code` immutability already
enforced in `DocTypesView.vue`). `name` and `is_active` are mutable. The edit DTO omits `code`.

**5. Shared schema is the single source of truth.**
Remove `DOC_CATEGORIES` and its `z.enum` from `@erp/shared`; the document-type schema's `category`
becomes `z.string().min(1)` (a code), and new `documentCategorySchema` / `documentCategoryUpdateSchema`
mirror the backend DTOs. `DocTypesView.vue` reads options from `useDocConfigStore` (new `categories`
state + fetch), not a constant.

**6. Migration is create + seed + drop-CHECK only.**
Because `document_type.category` keeps its code value and the seeded codes equal the existing values,
there is no column swap and no per-type backfill — the migration just adds the table, seeds per
company, and drops the enum CHECK constraint.

**7. Read/report paths are untouched; category stays a `code` string everywhere except validation.**
The config CRUD keeps `category` as a code (now validated against `document_category`). The
creatable-types read, the document-summary report grouping, and every API that returns
`category: <string>` are unchanged — no `category.code` dereference needed because `category` was
never turned into a relation. This preserves `MONEY_CATEGORIES` currency gating and report grouping
with zero behavior change.

## Risks / Trade-offs

- **No DB-level referential integrity between `document_type.category` and `document_category`** →
  Accepted, and identical to `default_gl_account` today. Write-time validation in the service is the
  guard; the immutable, canonical seeded codes mean a document type's code stays resolvable.
- **A category value that no longer matches any category** (e.g. a code deleted directly in SQL) →
  The type-list cell falls back to showing the raw code, and reporting groups it under that code —
  no crash. Deletion via the API is blocked while any type references the code.
- **Concurrent create of duplicate `code` in one company** → the `(company_id, code)` unique index
  is the backstop; the service returns a friendly 409 on unique violation (same pattern as
  document-type code).
- **Deactivating a category still used as a live filter value** → filtering is client-side over the
  already-fetched list; an inactive category simply stops appearing as a *new-type* option, existing
  rows still show it. No error path.

## Migration Plan

1. Create `document_category` table + `(company_id, code)` unique index + company FK.
2. Seed the 5 canonical categories (`PROCUREMENT`, `FINANCE`, `HR`, `ADMIN`, `IT`) for every
   `companies` row (idempotent via the unique constraint).
3. Drop the CHECK constraint pinning `document_type.category` to the old enum values. The `category`
   column keeps its existing code values — no swap, no backfill.
4. `seed-data.ts` also seeds `document_category` per company so a fresh DB has categories.
5. Ship shared + backend + frontend together.

**Rollback:** `down()` restores the enum CHECK constraint and drops `document_category`. This is
safe as long as no company has added a non-canonical category code to a document type (the restored
CHECK would then fail) — acceptable for a rollback path immediately after deploy.

## Open Questions

- Should deactivation surface a badge when a document type still uses the deactivated category?
  Proposed: out of scope; the type keeps a valid `category` code and the cell still renders.
- Do we want a per-company display order for categories now, or defer? Proposed: defer (Non-Goal).
