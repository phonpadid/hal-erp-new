## Context

`migration:up` builds the 37 tables but leaves them empty. rbac resolves a token's grants
from `role_permission → permission`, so without seeded `permission` rows and role wiring a
login yields no permissions and nothing is authorized. All entities and `PasswordService`
(bcryptjs) exist; the module `permissions.ts` files hold the 24 codes. MikroORM config
currently registers only `Migrator`. No schema change.

## Goals / Non-Goals

**Goals**
- An idempotent `seedDatabase(em)` producing a coherent demo baseline.
- Wire it to `@mikro-orm/seeder` (`DatabaseSeeder`) + a `seed` script, and make it
  unit-testable by calling `seedDatabase` directly.
- Demo accounts whose tokens carry real grants; a PR flow ready to submit/approve.

**Non-Goals**
- Production data, per-env variants, bulk volumes, or seeding transactional rows
  (documents / `budget_txn` / `approval_log`).

## Decisions

### D1 — One reusable `seedDatabase(em)`; thin SeedManager + test wrappers
Put the logic in `src/seed/seed-data.ts` as `export async function seedDatabase(em)`.
`src/seed/database.seeder.ts` (`DatabaseSeeder extends Seeder`) just calls it for
`mikro-orm seeder:run`; the spec test calls the same function against the test ORM. This
avoids coupling verification to the CLI and keeps one source of seed truth.

### D2 — Idempotent upserts by natural key
Each entity is created only if absent, looked up by its natural/unique key:
`permission.code`, `currency.code`, `company.code`, `department (company, dept_code)`,
`fiscal_year (company, year)`, `role (company, code)`, `app_user.username`,
`document_type.code`, `form_template (document_type, version)`,
`dept_doc_type (department, document_type)`, `budget (fiscal_year, department, gl_account)`,
`quota (company, quota_type)`-ish, `quota_entitlement (quota, employee, year)`,
`notification_template.code`, and join rows (`role_permission`, `user_company_role`) by
their pair/triple. A small `upsert(em, Entity, where, make)` helper centralizes the
find-or-create. Re-running creates nothing new (satisfies the idempotency scenario).

### D3 — Permissions sourced from the module constants
Import each module's `*Permissions` object and seed the union of their values, so the seed
can't drift from the codes the guards actually check. Each `permission` row gets a `module`
tag derived from the code prefix.

### D4 — Roles, scopes, and demo users
- **Admin** → every code at `COMPANY` scope.
- **Approver** → `DOC_VIEW`, `DOC_APPROVE` (COMPANY), `BUDGET_VIEW`.
- **Requester** → `DOC_VIEW`, `DOC_CREATE`, `DOC_SUBMIT`, `DOC_CANCEL` (DEPARTMENT),
  `MASTER_VIEW`.
Users `admin` / `approver` / `requester` (emails `*@demo.local`), password hashed via
`PasswordService`; a shared demo password documented in the README (clearly non-production).
`user_company_role`: each user → the company + a department + their role; `admin`'s row is
`is_default` so login issues a token immediately. An `employee` row for `requester` backs
the leave quota.

### D5 — Document / approval / budget / quota config for a runnable PR
- Document types: `PR` (`requires_budget`, `post_action = CUT_BUDGET`), `MEMO` (plain),
  `LEAVE` (`requires_quota`); each with a published `form_template` v1 and one required
  `form_field` (e.g. `reason`).
- A `workflow` (company) with one step targeting the **Approver** role (SEQUENTIAL).
- `dept_doc_type` mapping the requester's department → each type → its template + workflow.
- A `budget` for (current fiscal year, requester's department, a GL account) with a healthy
  `amount_total`; an `ANNUAL_LEAVE` `quota` + a `quota_entitlement` for the requester.
This makes the full create → submit (reserve) → approve (settle) path runnable end to end.

### D6 — Notification templates
Seed `DOC_PENDING_APPROVAL`, `DOC_REJECTED`, `DOC_COMPLETED`, `SLA_OVERDUE` as `IN_APP`
templates with `{doc_no}` / `{requester_name}` placeholders so the notification helpers
render real text instead of literal fallbacks.

### D7 — Config + script
Add `@mikro-orm/seeder`; register `SeedManager` in `extensions` and a `seeder` path
(`src/seed`) in the MikroORM config. Add `"seed": "mikro-orm seeder:run"` (the dev/ops
command is `migration:up` then `seed`).

## Risks / Trade-offs

- **Weak demo passwords** → documented as demo-only, `*@demo.local`; production must not run
  this seeder (or must rotate immediately). Noted in the README.
- **Seed vs. spec drift** → mitigated by sourcing permission codes from the module constants
  rather than re-listing them.
- **Idempotency edge cases** (partial prior seed) → upsert-by-key tolerates partially
  seeded DBs; join rows checked independently of their parents.
- **company filter** while seeding → the seeder runs outside request context; queries that
  touch company-scoped entities pass `{ filters: { company: false } }`.

## Migration Plan

No DB migration. Steps: add `@mikro-orm/seeder`; write `src/seed/seed-data.ts` (+ `upsert`
helper) and `DatabaseSeeder`; register `SeedManager` + seeder path; add the `seed` script;
add a Vitest that runs `seedDatabase` against the throwaway DB and asserts an `admin` login
resolves grants and the PR config exists; update the README. Verify with `pnpm build` +
`pnpm test`. Rollback = revert `src/seed/` + config/script (data only).

## Open Questions

- Should the seeder also create a couple of sample submitted documents for screenshots?
  Default: no (keep ledgers clean); a separate optional demo-flow script can do that later.
- Multiple demo companies to exercise company-switching in the shell? Default: one company
  now; add a second if the `web-shell` switcher needs a live multi-company demo.
