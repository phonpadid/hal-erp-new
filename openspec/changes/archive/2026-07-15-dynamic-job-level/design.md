## Context

Approval routing decides which workflow steps engage for a document partly by the requester's position level. Today that level lives in two disconnected places:

- `employee.job_level` — a free `varchar` (DBML: `job_level varchar`), validated only as an optional string on the employee DTO.
- The workflow-step condition `workflow_step.condition_json`, e.g. `{ "jobLevels": ["MANAGER"] }`, whose editor UI is locked to a hardcoded five-value const `JOB_LEVELS` in `@erp/shared`.

`WorkflowStepResolver` resolves the requester's level from their `employee` row and compares it to the step's `jobLevels` with an exact, case-sensitive `Array.includes`. The `approval-workflow` spec already rejects a submit into a *level-gated* workflow when the requester has **no** `job_level` (so a null level never silently skips steps). But nothing prevents a *present-but-mismatched* value (`"Manager"` vs `"MANAGER"`, a typo, or a level the enum doesn't list) from engaging or skipping the wrong steps. And the fixed five values cannot express an organization's real ladder.

This change turns job levels into per-company master data and adds a rank-threshold matching mode, without changing the append-only ledgers, budget math, or FX rules.

## Goals / Non-Goals

**Goals:**
- Per-company, configurable job levels as master data (`job_level`), mirroring `tax_code`/`department`.
- Eliminate the drift between `employee.job_level` and the workflow-step condition by sourcing both from the same table and validating the employee value against it.
- Support two step-engagement modes: explicit `jobLevels` list (existing) and `minRank` threshold (new), sharing one matching helper between router and submit-guard.
- Migrate existing free-text `employee.job_level` values without breaking any level-gated workflow.

**Non-Goals:**
- No change to how amount bands, `approve_mode`, or SLA drive routing.
- No FK column on `employee` (the link stays a validated `varchar` code, per decision below).
- No hierarchy/tree of levels beyond a single integer `rank`; `position` stays a separate free-text field.
- No change to budget or quota flows — this change writes neither `budget_txn` nor `quota_usage`.

## Decisions

### D1 — `job_level` as a company-scoped master-data table
Add `Table job_level { id, company_id, code, name, rank int, is_active }`, unique `(company_id, code)`, indexed by `(company_id)`. Rationale: mirrors the established master-data pattern (`tax_code`, `department`) so CRUD, company scope, and admin UI are consistent; upholds company isolation (invariant 1) — levels never cross companies. `rank` is a non-null integer expressing seniority order (higher = more senior) to support `minRank`.
- *Alternative considered*: a global (no `company_id`) table shared by all companies — rejected; it breaks per-company configurability the user asked for and diverges from the master-data pattern.

### D2 — `employee.job_level` stays a `varchar` code, validated against the table
Keep the column as-is; on employee create/update/promotion, validate that a non-empty `job_level` equals the `code` of an **active** `job_level` in the employee's company. Rationale: minimal migration and the resolver keeps comparing strings; `condition_json` already stores codes, so no format change. The validation closes the drift hole without a schema change to `employee`.
- *Alternative considered*: `employee.job_level_id uuid` FK — rejected for now; larger migration, resolver must join, and `condition_json` would need ids or a join too, for no additional guarantee once create/update validate the code. Referential cleanup (deactivating a level still referenced by employees) is handled by soft-delete (`is_active=false`), not FK constraints — see D5.

### D3 — Two matching modes in `condition_json`, one shared helper
`condition_json` may carry `{ "jobLevels": ["M1","M2"] }` (explicit) **or** `{ "minRank": 30 }` (threshold). A step engages when:
- explicit list present and non-empty → requester's level code ∈ list; or
- `minRank` present → requester's level `rank >= minRank`; or
- neither → step applies to everyone (unchanged).

The two keys are mutually exclusive per step; if both are somehow present, `jobLevels` takes precedence and the resolver ignores `minRank` (documented, deterministic). Matching stays **exact-code** (no case-folding) because codes now come from a controlled Select on both sides — normalization happens at write time (D6), not compare time, so the router has no hidden coercion.

Extend `@erp/shared`: keep `parseStepJobLevels` (returns the explicit list) and add `parseStepMinRank`. The resolver needs the requester's `rank`, so `requesterJobLevel` gains a companion that resolves `{ code, rank }` from the `job_level` table (one query, joined by company + code).
- *Alternative considered*: `minRank` only, dropping the explicit list — rejected; the user asked to keep both, and explicit lists express non-contiguous level sets a threshold can't.

### D4 — `JOB_LEVELS` const retired as a validator
Remove `JOB_LEVELS` as the source of truth for what levels exist; options now come from the `job_level` table via API. The shared package keeps only the *matching* logic (`parseStepJobLevels`, `parseStepMinRank`) so router and submit-guard cannot drift. Any remaining references to the const (tests, seeds) are repointed at seeded master rows.

### D5 — Deactivation over deletion
Levels are soft-deleted via `is_active=false` (like other master data). A level still referenced by an employee or a step condition can be deactivated but not hard-deleted; deactivated levels are excluded from the create/edit Select options but still resolve for existing employees so historical routing stays stable. The admin UI surfaces "in use" so an admin understands why a level can't be removed.

### D6 — Migration normalizes, then seeds
The migration is data-preserving (see Migration Plan). Normalization (trim, collapse case to a canonical form per company) happens once, in the migration, so post-migration all `employee.job_level` values exactly match a seeded `code`.

### Transaction / concurrency note
This change writes only `job_level` (master data) and `employee.job_level` (a plain column) — it touches **neither `budget_txn` nor `quota_usage`**, so no append-only ledger sequence, no `em.transactional` budget unit-of-work, and no `PESSIMISTIC_WRITE` budget/number locking are involved. `job_level` create/update follow the ordinary master-data path. The one place ordering matters is the data migration (schema create → normalize → seed → back-reference), which runs as a single migration transaction so a failure rolls back cleanly and leaves `employee.job_level` untouched.

## Risks / Trade-offs

- **Existing free-text values don't map cleanly to a single canonical code** (e.g. one company used both `"Mgr"` and `"MANAGER"`) → the migration seeds distinct normalized codes per company and logs any value it had to fold, so an admin can reconcile afterward; no employee is left pointing at a non-existent code.
- **A level-gated workflow could reject submits if migration misses a value** → migration back-references every employee to a seeded code before completing; a post-migration assertion fails the migration if any non-empty `employee.job_level` has no matching `job_level` row in its company.
- **`minRank` + explicit `jobLevels` both set on a step** → deterministic precedence (explicit wins) is specified and unit-tested, and the step editor prevents authoring both.
- **Case-sensitive matching retained** → acceptable because both sides are now controlled Selects over the same rows; write-time normalization removes the only realistic source of case drift.
- **Deactivating an in-use level** → soft-delete keeps existing routing valid; UI flags in-use so admins don't expect hard deletion.

## Migration Plan

Single migration (`job_level` + data), run in one transaction:
1. Create `job_level` table with unique `(company_id, code)`.
2. For each company, select distinct non-empty `employee.job_level`; normalize (trim/canonical-case); insert a `job_level` row per distinct normalized value with `code = normalized`, `name = original` (best-effort), an assigned `rank` (spaced increments so admins can reorder), `is_active = true`.
3. Update each `employee.job_level` to its normalized code.
4. Assert: no non-empty `employee.job_level` lacks a matching `(company_id, code)` row → else abort (rollback).
5. Seed default levels for companies that had none, so the master-data admin is not empty (optional, guarded).

Rollback: the migration's `down` drops `job_level`; because step 3 only normalizes casing/whitespace, the prior free-text values are recoverable from the migration log if a full revert of employee values is required. No ledger or approval-log rows are touched, so there is nothing append-only to unwind.

## Open Questions

- Default `rank` spacing and whether onboarding seeds a starter ladder for brand-new companies, or leaves master data empty until an admin defines it. (Leaning: seed a minimal starter set matching the retired `JOB_LEVELS` names so existing behavior is preserved out of the box.)
- Permission code for job-level CRUD: reuse an existing master-data manage code vs. a dedicated `JOB_LEVEL_MANAGE`. (Leaning: follow whatever `tax_code`/master-data currently uses for consistency.)
