## Why

The schema migrates clean but the database is **empty**, so nobody can log in and no flow
can run: rbac resolves a user's permissions from `role_permission → permission`, so with no
`permission` rows even a valid login carries zero grants. This change adds an **idempotent
seeder** that establishes a coherent demo baseline — the 24 permission codes, a company with
departments/fiscal year, currencies + a rate, roles wired to permissions, demo users, and
the document/budget/quota/workflow/notification configuration — so the whole stack
(`/auth/login` → submit → approve → settle → notify, and the Vue shell) is usable and
demoable against a fresh `new_erp`.

## What Changes

- **Seeder infrastructure**: add `@mikro-orm/seeder`, register `SeedManager`, and a
  `pnpm --filter back seed` script (`mikro-orm seeder:run`). A `DatabaseSeeder` delegates to
  a reusable `seedDatabase(em)` function (so it is also unit-testable).
- **Permissions**: insert all 24 codes (`COMPANY_*`, `DOC_*`, `BUDGET_*`, `QUOTA_*`,
  `MASTER_*`, `CURRENCY_*`, `WORKFLOW_MANAGE`, `RBAC_MANAGE`, `NOTIFICATION_*`, …) from the
  modules' permission constants.
- **Org**: one company (THB base) with two departments, the current fiscal year (OPEN),
  and a holiday sample.
- **Currency**: `THB`, `USD`, `JPY` (+ a `USD→THB` daily rate) for FX/rounding demos.
- **RBAC**: roles **Admin** (all codes, COMPANY scope), **Approver** (`DOC_VIEW`/`DOC_APPROVE`,
  `BUDGET_VIEW`), **Requester** (`DOC_VIEW`/`DOC_CREATE`/`DOC_SUBMIT`/`DOC_CANCEL`,
  `MASTER_VIEW`) wired via `role_permission`; demo users `admin` / `approver` / `requester`
  (hashed passwords) assigned via `user_company_role` (admin = default company).
- **Master data**: a couple of vendors + items, enabled for the company.
- **Documents/approval config**: document types **PR** (`requires_budget`, `CUT_BUDGET`),
  **MEMO** (plain), **LEAVE** (`requires_quota`); a published form template (with a required
  field) per type; a `workflow` with an Approver step; `dept_doc_type` mappings.
- **Budget/quota**: a budget for the PR department + GL, and an `ANNUAL_LEAVE` quota with an
  entitlement for the requester.
- **Notifications**: templates `DOC_PENDING_APPROVAL`, `DOC_REJECTED`, `DOC_COMPLETED`,
  `SLA_OVERDUE` (IN_APP) with `{doc_no}`/`{requester_name}` placeholders.
- **Idempotent**: every row is upserted by its natural key (permission code, company code,
  username, role code, doc-type code, …), so re-running the seeder is safe.
- **Docs**: README note with the demo credentials and `migration:up && seed` steps.

No schema change and no runtime behavior change — this is data + tooling.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `platform-foundation`: adds one requirement — an idempotent bootstrap seeder that
  establishes a demoable baseline (permissions + a company, users/roles, and the
  document/budget/quota/workflow/notification config) so a freshly migrated database is
  usable. No existing requirement changes.

## Impact

- **Affected**: `back/` only — a `src/seed/` module, `mikro-orm.config` (add `SeedManager`),
  a `seed` script, README. Consumes existing entities + `PasswordService`/permission
  constants.
- **Invariants respected**: 5 (seeds `permission` + `role_permission`; roles carry codes,
  scopes) and 1 (all rows scoped to the demo company). Append-only ledgers are untouched
  (no `budget_txn`/`approval_log` seeded).
- **New dependency (dev)**: `@mikro-orm/seeder`.
- **Unblocks**: real login in the Vue shell and live end-to-end testing; the upcoming
  `web-documents` / `web-approvals` screens.

## Out of Scope

- Production data / real users — this is a **demo/dev** baseline (clearly weak passwords,
  documented as not for production).
- Per-environment seed variants or large volumes; bulk/import tooling.
- Seeding transactional rows (documents, budget_txn, approvals) — those are created by
  exercising the app, not seeded.
