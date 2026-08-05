## 1. Preconditions

- [x] 1.1 Confirm no migration or DBML change is needed: the bootstrap writes only `company`,
      `department`, `role`, `role_permission`, `app_user` and `user_company_role`, all existing
      tables with existing columns
- [x] 1.2 Confirm the password policy the product's change-password flow enforces, so the
      bootstrap validates against the same one rather than a second copy of the rules
      — `passwordPolicy` in `@erp/shared` (min 8, at least one letter and one digit), hashed by
      `PasswordService` (bcrypt, cost 10)

## 2. Bootstrap Logic

- [x] 2.1 Create `back/src/seed/bootstrap-admin.ts` exporting a `bootstrapAdmin(em, input)` that
      takes a resolved input object and returns a report of what it created — no `process.env`
      reads and no `console` inside, so it is testable against a real database
- [x] 2.2 Implement the input contract: username, email, password, company code, company name and
      base currency code are all required; the department is not an input, because
      `provisionCompany` already fixes it as `HQ` / `Head Office`
- [x] 2.3 Implement the prerequisite check — abort naming `pnpm --filter back seed:prod` when the
      `permission` table is empty or the named currency is not an active `currency` row
- [x] 2.4 Implement the run-once guard — abort when `app_user` holds any row, whatever its state
- [x] 2.5 Validate the password against the product's policy and hash it with `PasswordService`
- [x] 2.6 Create the six rows inside a single `em.transactional()`: the account (with
      `email_verified_at` set), then the company graph
- [x] 2.7 Extract the company graph into `provisionCompany` in the multi-company module and have
      `CompanyService.create` use it too, so the ADMIN grant rule — whole active catalog at
      `COMPANY` scope, group reporting at `GROUP` — exists once rather than twice
- [x] 2.8 Return a report naming every row created, so the rollback in the README is actionable

## 3. Command Wrapper

- [x] 3.1 Create `back/scripts/bootstrap-admin.ts` — reads the `BOOTSTRAP_*` variables, owns the
      MikroORM lifecycle, prints the report, and exits non-zero on refusal
- [x] 3.2 Fail closed on a missing or empty variable, naming it, before the ORM connects
- [x] 3.3 Ensure the password is never printed, on success or on failure, including inside any
      error the ORM or the validator raises (`redact`, applied to every error on the way out)
- [x] 3.4 Add `"bootstrap:admin": "ts-node -P tsconfig.json scripts/bootstrap-admin.ts"` to
      `back/package.json`, beside `seed:prod`
- [x] 3.5 Write the file header comment in the register of `seed-essentials.ts`: what it creates,
      why it refuses, and that it is run by hand and never by the deploy

## 4. Tests

- [x] 4.1 `back/src/seed/bootstrap-admin.spec.ts`, DB-backed against a refreshed schema
- [x] 4.2 Happy path: the six rows exist, the membership is default, and `RbacAuthService.login`
      with the supplied credentials returns a company-context token
- [x] 4.3 The issued token carries the permission codes needed to reach the RBAC admin surface
      (`RBAC_MANAGE`, `COMPANY_MANAGE`, `EMPLOYEE_MANAGE`), and as many grants as the report claims
- [x] 4.4 Refusal: a database holding any `app_user` row is rejected and nothing is written
- [x] 4.5 Refusal holds when the existing account is inactive, unverified, or holds no membership
- [x] 4.6 Refusal: empty `permission` catalog, and an unresolvable currency, each abort before writing
- [x] 4.7 Fail-closed: each required input, absent, aborts with nothing written (table-driven over
      `BOOTSTRAP_ENV`, so a new variable cannot be added without a case)
- [x] 4.8 A password failing the product's policy is refused and no `app_user` row is created
- [x] 4.9 `app_user.password_hash` verifies the supplied password and is not the password itself
- [x] 4.10 Atomicity: a failure injected after the account is created leaves no rows behind
- [x] 4.11 The grant covers every active `permission` row, `COMPANY` scope except group reporting at
      `GROUP` — asserted against the table, not a fixed count
- [x] 4.12 The wrong password for the bootstrapped account is rejected
- [x] 4.13 `resolveBootstrapInput` names the missing variable, treats whitespace as absence, trims
      what it accepts; `redact` removes the password and leaves an unset one alone

## 5. Deploy Guard

- [x] 5.1 Confirm `.github/workflows/deploy.yml` invokes no account-creating command, and extend
      the comment on the seeding step to name the bootstrap alongside the demo seeder
- [x] 5.2 Add `back/src/seed/deploy-creates-no-accounts.spec.ts` asserting the deploy workflow runs
      neither `seeder:run` nor `bootstrap:admin`, ignoring the comments that name them in order to
      forbid them, so the prohibition is checked rather than remembered

## 6. Documentation

- [x] 6.1 `back/README.md`: the first-run procedure — `migration:up`, `seed:prod`,
      `bootstrap:admin`, sign in, change the password, create real roles through the product
- [x] 6.2 Document each `BOOTSTRAP_*` variable in `back/.env.example`, marked as bootstrap-only and
      not read by the running application
- [x] 6.3 State in the README that the variables are set from an env file or a `read -s` prompt,
      never inline on the command line, and that the account's password is changed after first
      sign-in

## 7. Verification

- [x] 7.1 `pnpm --filter back run test` passes — 1182 passed, 36 skipped
- [x] 7.2 `pnpm --filter back boot:check` passes — no provider is disturbed
- [x] 7.3 End-to-end on a scratch database: `migration:up`, `seed:prod`, `bootstrap:admin`, then a
      real `POST auth/login` against the running API returning a company-context token carrying 63
      grants with `REPORT_GROUP_VIEW` at `GROUP`
- [x] 7.4 Re-run `bootstrap:admin` on that same database and confirm it refuses
- [x] 7.5 `openspec validate bootstrap-first-admin`
- [x] 7.6 The existing company suites still pass unchanged, which is what says the `provisionCompany`
      extraction preserved behaviour
