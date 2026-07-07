## 1. Seeder infrastructure

- [x] 1.1 Add `@mikro-orm/seeder`; register `SeedManager` in `mikro-orm.config.ts` `extensions` and add a `seeder` path (`src/seed`, ts under `src/seed`).
- [x] 1.2 Add a `seed` script (`"seed": "mikro-orm seeder:run"`) to `back/package.json`.
- [x] 1.3 `src/seed/database.seeder.ts` (`DatabaseSeeder extends Seeder`) delegating to `seedDatabase(em)`.

## 2. Seed logic (idempotent)

- [x] 2.1 `src/seed/seed-data.ts`: a `upsert(em, Entity, where, make)` find-or-create helper (uses `{ filters: { company: false } }` for scoped reads); `seedDatabase(em)` orchestrates the steps below.
- [x] 2.2 Permissions: union the modules' `*Permissions` constants → one `permission` row per code (module tag from the prefix).
- [x] 2.3 Org + currency: company (THB base), 2 departments, current OPEN fiscal year, a holiday; currencies `THB`/`USD`/`JPY` + a `USD→THB` daily rate.
- [x] 2.4 RBAC: roles Admin/Approver/Requester; `role_permission` wiring (Admin=all COMPANY; Approver=DOC_VIEW/DOC_APPROVE+BUDGET_VIEW; Requester=DOC_VIEW/CREATE/SUBMIT/CANCEL DEPARTMENT + MASTER_VIEW). Users `admin`/`approver`/`requester` (hashed via `PasswordService`), an `employee` for requester, `user_company_role` assignments (admin `is_default`).
- [x] 2.5 Master data: 2 vendors + 2 items, each enabled for the company (`vendor_company` / `item_company`).
- [x] 2.6 Document config: types `PR` (requires_budget, CUT_BUDGET) / `MEMO` / `LEAVE` (requires_quota); a published `form_template` v1 + a required `form_field` each; a `workflow` + an Approver-role step; `dept_doc_type` mappings for the requester's department.
- [x] 2.7 Budget/quota: a `budget` (current FY, requester dept, GL) with a healthy total; an `ANNUAL_LEAVE` `quota` + `quota_entitlement` for the requester (current year).
- [x] 2.8 Notification templates: `DOC_PENDING_APPROVAL`, `DOC_REJECTED`, `DOC_COMPLETED`, `SLA_OVERDUE` (IN_APP) with `{doc_no}`/`{requester_name}` placeholders.

## 3. Docs

- [x] 3.1 README note: `migration:up` then `pnpm --filter back seed`; list demo credentials (`admin`/`approver`/`requester` + the demo password) marked demo-only / not for production.

## 4. Tests

- [x] 4.1 Seed test (DB-backed): run `seedDatabase(em)` on a fresh schema, then assert `admin` authenticates via `RbacAuthService` and the issued token's grants include the seeded codes (e.g. `DOC_APPROVE`); the PR document type, its mapping, the workflow step, and the budget all exist.
- [x] 4.2 Idempotency: run `seedDatabase(em)` twice and assert `permission` / `app_user` / `role` counts are unchanged after the second run.

## 5. Verify

- [x] 5.1 `pnpm --filter back build` and `pnpm --filter back test` pass.
- [x] 5.2 Run `openspec validate seed-bootstrap-data --strict`.
