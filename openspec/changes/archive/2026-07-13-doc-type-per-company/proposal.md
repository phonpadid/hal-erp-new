## Why

`document_type` is a group-wide table with no `company_id`, and its `code` is globally
unique. `DocumentTypeService.list()` applies no company filter, so **every company sees and
manages every other company's document types** — they are merged into one global list. That
breaks company isolation (invariant 1): a PR type set up for company A appears in company B's
configuration, and two companies cannot both own a `PR` code. Document types should belong to
a company, like accounts, budgets, and workflows already do.

## What Changes

- Add `company_id` to `document_type` (**BREAKING**), making each type owned by one company.
- Change `code` uniqueness from global to **per company** (`(company_id, code)`), so each
  company can have its own `PR`, `PO`, etc.
- Scope every document-type read/write to the active company (list, get, create, update),
  using the standard company filter — the config list now shows only the active company's
  types.
- Guard consistency: a `dept_doc_type` mapping's department and its document type MUST belong
  to the same company; a document's type MUST belong to the document's company.
- Migration: assign all existing (global) types to a **single primary company** (the earliest
  company); other companies start with no types and create their own.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `document-engine`: `document_type` is company-owned (`company_id`); `code` is unique per
  company; type reads/writes and the department mapping are company-scoped and consistent.
- `web-doc-config`: the document-type admin lists, creates, and edits only the active
  company's types (the list is genuinely company-scoped, not global).

## Impact

- **Schema (BREAKING)**: add `company_id uuid [not null]` to `document_type`; replace the
  global unique on `code` with a `(company_id, code)` unique. Migration adds the column
  nullable, backfills every row to the primary company, sets it NOT NULL, and swaps the unique
  index.
- **Backend**: `DocumentType` entity extends `CompanyScopedEntity` + a `company` relation;
  `DocumentTypeService` scopes list/get/update/create to the active company and enforces
  per-company code uniqueness; `DeptDocTypeService` rejects mapping a type from another
  company; `DocumentService.createDraft` verifies the type belongs to the active company.
- **Frontend**: the doc-type admin naturally shows only the active company's types (company
  context already on the JWT); no per-row change beyond the now-scoped list.
- **Invariants**: restores company isolation (invariant 1) for document types. Backward
  compatible after backfill only for the primary company; other companies must (re)create
  their types — an intended consequence of un-merging.
