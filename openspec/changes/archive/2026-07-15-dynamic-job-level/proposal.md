## Why

Job levels are hardcoded to a fixed five-value enum (`STAFF/SUPERVISOR/MANAGER/DIRECTOR/EXECUTIVE`) in `@erp/shared`, but `employee.job_level` is a free `varchar` with no constraint tying it to that enum. The two sides can silently diverge (case, typos, an unlisted value), and the approval router compares them with an exact case-sensitive string match — so a mismatch makes an approval step engage or skip incorrectly with no error or log. Organizations also need their own level ladders (grades, C-levels, localized names) rather than one fixed set. Making job levels configurable per company both fixes the drift bug and removes the artificial five-value limit.

## What Changes

- Introduce a company-scoped **`job_level` master-data table** — `{ id, company_id, code, name, rank, is_active }`, unique `(company_id, code)` — mirroring the `tax_code`/`department` master-data pattern. Each company defines its own levels.
- Add **CRUD** for `job_level` (service + DTOs + permission-code guard + company scope) and an **admin UI** under master-data management.
- **`employee.job_level` stays a `varchar` code** but is now validated on create/update to reference an existing, active `job_level.code` in the active company. Remove the unconstrained `@IsString`-only rule.
- The **workflow-step "Engage for levels" condition** supports two matching modes: the existing explicit `{ "jobLevels": [...] }` list **and** a new `{ "minRank": N }` threshold that engages a step when the requester's job level `rank >= N`. This keeps routing stable as levels are added.
- Both the **workflow-step editor** and the **employee form** source their level options from the `job_level` master table, so the routing condition and the requester's level can never reference different value sets. Add the currently-missing `job_level` input to employee onboarding.
- **Retire the hardcoded `JOB_LEVELS` const** as a validation source; keep and extend the shared matching helper (`parseStepJobLevels`) to understand both `jobLevels` and `minRank`.
- **Data migration**: create the `job_level` table, seed each company's distinct existing `employee.job_level` values as rows (normalized), and back-reference employees to the seeded codes so no existing routing silently breaks.

## Capabilities

### New Capabilities
- `job-level`: Company-scoped job-level master data — its shape, uniqueness, `rank` ordering, active/inactive lifecycle, company isolation, and the rule that job-level codes referenced elsewhere (employees, workflow steps) must resolve to an active row in the same company.

### Modified Capabilities
- `approval-workflow`: Step engagement by requester level gains a `minRank` matching mode alongside the existing `jobLevels` list; matching is defined against `job_level` master rows rather than a fixed enum.
- `employee-registry`: An employee's `job_level`, when present, MUST be a code of an active `job_level` in the employee's company; promotions setting a new level are validated the same way.
- `web-doc-config`: The workflow-step editor sources "Engage for levels" options from the `job_level` master table and lets the admin choose the explicit-list or `minRank` mode.
- `web-employee-admin`: The employee create/edit/onboard forms present `job_level` as a Select bound to the company's active `job_level` master rows (a field currently absent from onboarding).
- `web-master-data`: Adds a `job_level` management surface (list/create/edit/deactivate) to the master-data admin area.

## Impact

- **DBML**: adds `Table job_level`; `employee.job_level` semantics documented as a `job_level.code` reference.
- **Backend**: new `JobLevel` entity + migration; new job-level module (service/controller/DTOs/permission code); `WorkflowStepResolver.stepMatches`/`requesterJobLevel` extended for `minRank`; employee create/update/promotion validation against the master table.
- **Shared**: `parseStepJobLevels` extended (and a `minRank` parser added); `JOB_LEVELS` const removed as a validator, matching logic retained in shared so router and submit-guard cannot drift.
- **Frontend**: new master-data admin view + store/API; workflow-step editor and employee forms switch to master-sourced Selects; add job-level field to onboarding.
- **Invariants**: reinforces company isolation (invariant 1) — job levels never cross companies; upholds config-over-code (invariant 7) by moving level definitions out of code. No change to append-only ledgers, budget math, or FX.
- **Migration risk**: existing `employee.job_level` free-text values must be normalized and seeded, or level-gated workflows could reject/misroute on submit; the migration must be data-preserving.
