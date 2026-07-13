## Context

`document_type` (no `company_id`, `code` globally unique) is read without a company filter, so
the config list and the type registry are shared across all companies. Every other main table
that belongs to a company (`account`, `budget` via fiscal year, `workflow`, `department`) is
company-scoped through the standard `company` filter on `CompanyScopedEntity` +
`CompanyScopeService.forActiveCompany()`. Document types are the outlier. Related tables:
`dept_doc_type` (department → type, per company via department), `form_template` (per type),
`document` (has both `company_id` and `document_type_id`).

## Goals / Non-Goals

**Goals:**
- Each `document_type` belongs to exactly one company; reads/writes are company-scoped.
- `code` is unique per company, not globally.
- Cross-company references are impossible: a department maps only its own company's types; a
  document's type matches its company.

**Non-Goals:**
- No "shared template library" of types across companies (a type is owned, not shared). If a
  cross-company catalog is ever wanted, that is a separate feature.
- No change to type *behavior* flags (`requires_budget`, etc.) or to numbering/forms/workflows
  beyond making the type company-scoped.

## Decisions

- **`document_type` gets a `company` relation and is scoped EXPLICITLY (not via
  `CompanyScopedEntity`).** Making it a `CompanyScopedEntity` was tried first but its default
  `company` filter rippled to every `documentType` read across the app (submit, PDF export,
  post-actions, SLA, reporting — ~10 sites load the type on an unscoped `em.fork()` and would
  throw "No arguments provided for filter 'company'"). Instead — like `budget`, which is scoped
  through its fiscal year rather than an auto-filter — `DocumentType extends BaseEntity` with a
  `@ManyToOne company` + `@Unique(['company','code'])`, and `DocumentTypeService` filters by
  `company` explicitly on list/get/create/update. Same outcome (per-company list/get, per-company
  code), no app-wide ripple.
- **`code` unique per `(company_id, code)`.** Drop the global unique on `code`; add a composite
  unique. Create/rename checks uniqueness within the active company only, so two companies may
  both own `PR`.
- **Backfill to a single primary company.** Existing global types are assigned to the earliest
  company (`company` ordered by `created_at` — the main/first company). Other companies then
  have no types and create their own. Chosen over duplicating each type per company (which would
  also require re-pointing `dept_doc_type`/`form_template` per company) for simplicity, per the
  decision to un-merge cleanly; the migration is reversible only structurally (see below).
- **Consistency guards.** `DeptDocTypeService` rejects mapping a department to a type of another
  company (department.company ≠ type.company → 400). `DocumentService.createDraft` loads the
  type through the scoped em, so a type from another company is not-found. These make the new
  invariant enforced, not just modeled.
- **`form_template` inherits scope through its type.** No `company_id` on `form_template`; it is
  reachable only via a company-scoped type, so no separate change is needed.

## Risks / Trade-offs

- **Other companies lose their types after backfill** → intended (types were never really
  theirs; they were the primary company's, shared by accident). They recreate types they need.
  Flagged as BREAKING in the proposal.
- **A department in a non-primary company mapped to a (now primary-owned) type** → after backfill
  that mapping crosses companies. Mitigation: the migration should also deactivate/repair
  `dept_doc_type` rows whose department company ≠ the type's new company (drop or flag them), so
  no cross-company mapping survives. Documented as a migration step.
- **Existing documents reference a type now owned by the primary company** → historical
  documents keep their `document_type_id`; reads of a document don't re-scope the type join for
  display, so old documents in other companies still render. New creation is guarded. Acceptable.

## Migration Plan

1. Add `document_type.company_id` nullable.
2. Backfill: `company_id = (the earliest company)` for all rows.
3. Set `company_id` NOT NULL; drop the global unique on `code`; add unique `(company_id, code)`.
4. Repair `dept_doc_type`: deactivate rows whose department's company ≠ the type's company, so
   no cross-company mapping remains selectable.
- Rollback: drop `company_id`, restore the global unique on `code`. Per-company divergence
  created after the change cannot be collapsed back to one global code space if two companies
  created the same code — forward-only once multiple companies define overlapping codes.

## Open Questions

- Should the primary company be configurable (an env/setting) rather than "earliest company"?
  Current decision: earliest company, deterministic and adjustable in the migration if a
  specific primary is required before running it.
