## 1. Data model & migration

- [x] 1.1 Update `erp_approval_system.dbml`: add `Table job_level { id, company_id, name, code, rank int, is_active }` with unique `(company_id, code)` and note that `employee.job_level` holds a `job_level.code` in the same company.
- [x] 1.2 Add a `JobLevel` MikroORM entity (company-scoped) mirroring the DBML, with the unique `(company_id, code)` index and a non-null integer `rank`.
- [x] 1.3 Write a single data-preserving migration: create `job_level`; per company seed distinct normalized `employee.job_level` values (`code = normalized`, `name = original`, spaced `rank`, `is_active = true`); update each `employee.job_level` to its normalized code; assert no non-empty `employee.job_level` lacks a matching `(company_id, code)` row (abort/rollback on failure); log every folded value.
- [x] 1.4 In the migration, optionally seed a starter ladder (matching the retired `JOB_LEVELS` names/ranks) for companies that had no job-level values, so master data is not empty; implement a `down` that drops `job_level`.

## 2. Shared matching logic

- [x] 2.1 In `@erp/shared`, keep `parseStepJobLevels` (explicit list) and add `parseStepMinRank` to read `{ "minRank": N }` from `condition_json`; document the precedence rule (explicit `jobLevels` wins when both present).
- [x] 2.2 Add a shared Zod schema + type for the `job_level` create/edit form (code, name, rank) and extend the workflow-step condition schema to accept either `jobLevels` or `minRank` (mutually exclusive), mirroring the backend DTO.
- [x] 2.3 Remove `JOB_LEVELS` as a validation source; repoint any remaining const references (tests/seeds) at seeded master rows. Keep matching logic in shared so router and submit-guard cannot drift.
- [x] 2.4 Unit-test `parseStepJobLevels`/`parseStepMinRank`: explicit list, minRank threshold, both-present precedence, empty/malformed → no restriction.

## 3. Job-level master-data backend (entity → service → controller → tests)

- [x] 3.1 Create the job-level module: service with company-scoped `list` (incl. `includeInactive` for admin), `create`, `update`, `deactivate`; reject duplicate `(company_id, code)`; enforce active-company scope.
- [x] 3.2 Add DTOs (class-validator) for create/update; add `JOB_LEVEL_VIEW` / `JOB_LEVEL_MANAGE` permission codes and guard every endpoint on the code (never a role name).
- [x] 3.3 Enforce deactivate-over-delete: block hard-delete of a `job_level` referenced by any `employee` or step `condition_json`; deactivation sets `is_active=false` and excludes the row from assignable option sets while still resolving existing references.
- [x] 3.4 Controller: `ParseUUIDPipe` on id params, company scope from JWT context; return list ordered by `rank`.
- [x] 3.5 Unit tests: company isolation (same code in two companies), duplicate-code rejection, permission-code gating, deactivate keeps existing references resolving, hard-delete of in-use level rejected.

## 4. Approval routing (resolver) for both matching modes

- [x] 4.1 Extend `WorkflowStepResolver.requesterJobLevel` to also resolve the requester's `rank` from the company `job_level` row (one query joined by company + code); expose `{ code, rank }`.
- [x] 4.2 Extend `stepMatches` to engage on: explicit `jobLevels` includes code, OR `minRank` ≤ requester rank, OR no condition; apply explicit-wins precedence when both keys present; keep exact-code (no case-folding) matching.
- [x] 4.3 Update the submit level-gated guard so a workflow with any step carrying a non-empty `jobLevels` OR a `minRank` is treated as level-gated (missing requester level → reject submit as today).
- [x] 4.4 Unit tests on the resolver: explicit-list gate, minRank gate (below/at/above threshold), both-present precedence, unrestricted applies to all, and level-gated submit rejection when requester has no level.

## 5. Employee registry validation

- [x] 5.1 Replace the unconstrained `@IsString` `jobLevel` rule on the employee create/update DTO path with validation that a non-empty `job_level` resolves to an active `job_level.code` in the employee's company (empty allowed).
- [x] 5.2 Apply the same job-level validation to the promotion path (`UPDATE_EMPLOYEE`), within the caller-supplied transaction; only provided fields change.
- [x] 5.3 Unit tests: create/update/promotion accept a valid code, reject an unknown code, and allow empty; company scope respected.

## 6. Frontend — job-level admin (web-master-data)

- [x] 6.1 Add a typed API client + Pinia store for job-level CRUD (company-scoped, `includeInactive` for admin).
- [x] 6.2 Add a job-level management surface in the "Master data" area: list (`code`, `name`, `rank`, active), create/edit form via `@primevue/forms` + `zodResolver` (shared schema), and deactivate; gate affordances by `JOB_LEVEL_VIEW`/`JOB_LEVEL_MANAGE` (UX-only). Style with PrimeUI tokens (light/dark).
- [x] 6.3 Component tests: options/list load per active company, duplicate-code blocked before submit, deactivate marks inactive, permission gating hides manage affordances.

## 7. Frontend — employee form job-level Select (web-employee-admin)

- [x] 7.1 Replace the free/absent `job_level` input with a Select sourced from the active company's active `job_level` rows (present by name/code, submit code, allow empty) on the edit form.
- [x] 7.2 Add the `job_level` Select to the employee onboarding/create page (currently missing); reload options on active-company switch.
- [x] 7.3 Component tests: options come from the master list, empty allowed, company switch reloads options.

## 8. Frontend — workflow-step editor (web-doc-config)

- [x] 8.1 Change "Engage for levels" options to come from the `job_level` master (drop the hardcoded `JOB_LEVELS`); keep the MultiSelect for explicit-list mode.
- [x] 8.2 Add a mode toggle to author either an explicit `jobLevels` list or a `minRank` threshold; make the two mutually exclusive (clear/disable the other); serialize into `condition_json`.
- [x] 8.3 Update the workflow detail/step summary to render a `minRank` condition as "that level and above" and the explicit list as before.
- [x] 8.4 Component tests: options from master, explicit vs minRank serialization, mutual exclusivity, summary rendering.

## 9. Validation & wrap-up

- [x] 9.1 Update/seed data and any fixtures that referenced the removed `JOB_LEVELS` const (backend seed, e2e).
- [x] 9.2 Run backend + frontend unit tests and the migration against a seeded DB; confirm no level-gated workflow rejects a previously-valid requester after migration.
- [x] 9.3 `openspec validate dynamic-job-level` passes; update i18n labels (en/la) for the job-level admin and the step editor's mode/minRank controls.
