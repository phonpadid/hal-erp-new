## 1. Backend project & ORM wiring

- [x] 1.1 Add backend deps to `back/package.json`: `@mikro-orm/core`, `@mikro-orm/postgresql`, `@mikro-orm/nestjs`, `@mikro-orm/migrations`, `@mikro-orm/cli`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `class-validator`, `class-transformer`, `@nestjs/config`, and a decimal lib (`decimal.js`).
- [x] 1.2 Add `back/.env.example` (DB host/port/user/pass/name, JWT secret, MinIO/S3 vars) and a root `docker-compose.yml` running PostgreSQL 15 + MinIO.
- [x] 1.3 Create `back/mikro-orm.config.ts` (PostgreSQL driver, entities glob, migrations path, `forceUndefined`, decimal handling) and register `MikroOrmModule.forRoot()` in `app.module.ts` via `@nestjs/config`.
- [x] 1.4 Define the 5 DBML enums as TS string enums in `back/src/common/enums/` (`doc_status`, `budget_txn_type`, `doc_category`, `approve_action`, `control_policy`).

## 2. MikroORM entities from the DBML (all 37 tables)

> Hand-author per the DBML using exact table/column names; money columns as `type: 'decimal'` carried as `string`; model every `Ref:` as a relation. After each group, the schema must still be diff-clean against the migration created in task 3.

- [x] 2.1 multi-company module entities: `company`, `department` (self-ref `parent_dept_id`), `fiscal_year`, `holiday_calendar`.
- [x] 2.2 rbac module entities: `app_user`, `permission`, `role`, `role_permission`, `user_company_role`, `employee` (1-1 `user_id`).
- [x] 2.3 currency module entities: `currency` (string PK `code`), `exchange_rate` (`rate` decimal(18,8)); wire `company.base_currency`, `document.currency` refs.
- [x] 2.4 budget module entities: `budget` (`amount_total` decimal(15,2)), `budget_txn` (decimal amount; mark append-only), `budget_movement`.
- [x] 2.5 quota module entities: `quota` (`limit_value` decimal), `quota_usage` (`qty_used` decimal), `quota_entitlement`.
- [x] 2.6 document module entities: `document_type`, `form_template`, `form_field`, `dept_doc_type`, `document` (decimal amount, self-ref `ref_document_id`), `doc_field_value`, `document_line` (decimal), `document_attachment`, `doc_running_number`.
- [x] 2.7 approval module entities: `workflow`, `workflow_step`, `approval_delegation`, `approval_log` (mark append-only).
- [x] 2.8 master-data module entities: `vendor`, `vendor_company`, `item`, `item_company`.
- [x] 2.9 notifications module entities: `notification_template`, `notification`.
- [x] 2.10 Verify count: exactly 37 entities mapped, every `Ref:` line represented as a relation, all unique indexes from the DBML declared.

## 3. Initial migration

- [x] 3.1 Run `mikro-orm migration:create --initial`; commit the generated migration under `back/src/migrations/`.
- [x] 3.2 Apply the migration to a fresh Postgres and confirm `mikro-orm schema:update --dump` produces an empty diff (acceptance gate for "migration reproduces the schema").

## 4. Cross-cutting backend seams

- [x] 4.1 Add a shared `Money` helper (decimal add/subtract/compare) and a MikroORM decimal type config so monetary values round-trip as exact strings; add a unit test asserting `"1234567.89"` round-trips.
- [x] 4.2 Implement `RequestContext` (AsyncLocalStorage) holding `userId`, active `companyId`, and permission codes, populated by middleware/guard from the JWT.
- [x] 4.3 Implement the company-scope seam: a MikroORM global `company` filter + base class/marker for company-owned entities, enabled with the active `companyId` by default; GROUP-scope reads explicitly disable it (read-only).
- [x] 4.4 Implement append-only enforcement for `budget_txn` and `approval_log`: insert/read-only repositories plus a flush subscriber that throws on scheduled update/delete of those entities.
- [x] 4.5 Implement `AuthModule` (`@nestjs/jwt` + passport-jwt) issuing/validating a JWT payload `{ sub, companyId, permissions: string[] }`.
- [x] 4.6 Implement `@RequirePermissions(...codes)` decorator + `PermissionsGuard` authorizing on permission codes (never role names).
- [x] 4.7 Wire global `ValidationPipe` (whitelist, forbidNonWhitelisted, transform) in `main.ts` and adopt `ParseUUIDPipe` convention for UUID params.
- [x] 4.8 Add a documented `em.transactional()` unit-of-work helper and a `LockMode.PESSIMISTIC_WRITE` usage convention for future budget reservation / `doc_running_number` issuance.

## 5. Backend test tooling (Jest → Vitest, + Playwright)

- [x] 5.1 Remove Jest config/deps from `back/package.json`; add `vitest` + config (`back/vitest.config.ts`); point `test`/`test:watch`/`test:cov` scripts at Vitest.
- [x] 5.2 Port `app.controller.spec.ts` to Vitest and confirm the sample unit test passes.
- [x] 5.3 Add `@playwright/test` with a config and one sample e2e against the running app.
- [x] 5.4 Add an illustrative concurrency test using `LockMode.PESSIMISTIC_WRITE` on a counter row, demonstrating the locking pattern future numbering/reservation endpoints must follow.

## 6. Shared schema seam

- [x] 6.1 Create root `shared/` workspace package (pnpm workspace across `back`, `front-end`, `shared`) exporting Zod schemas.
- [x] 6.2 Add one sample shared Zod schema; consume it in a backend DTO (via `nestjs-zod` or a mirrored class-validator DTO) so client and server derive from one source.

## 7. Frontend wiring

- [x] 7.1 Add frontend deps to `front-end/package.json`: `primevue`, `@primevue/themes`, `@primevue/forms`, `primeicons`, `tailwindcss`, `tailwindcss-primeui`, `zod`, `pinia`, `vue-router`, `axios`.
- [x] 7.2 Configure Tailwind (`tailwind.config`, PostCSS) with the `tailwindcss-primeui` plugin; set up `style.css` using theme tokens only (no hardcoded colors).
- [x] 7.3 Wire `main.ts`: install PrimeVue (styled mode, Aura preset, `darkModeSelector: '.dark'`), PrimeIcons CSS, Pinia, and Vue Router.
- [x] 7.4 Add `useAuthStore` (Pinia) holding active company + permission codes, and a `can(code)` / `v-can` helper that gates UI affordances by permission code.
- [x] 7.5 Add a typed API client (axios wrapper) that attaches the company-context JWT to every request.
- [x] 7.6 Build one sample `@primevue/forms` form (`<Form :resolver>` + `<FormField>` + `<Message>`) using `zodResolver` with the shared schema from task 6.2.

## 8. Verification & docs

- [x] 8.1 Confirm the frontend mounts with the Aura theme and that toggling `.dark` switches light/dark with no hardcoded colors.
- [x] 8.2 Update `back/README.md` and `front-end/README.md` (and a root note) with install, `docker-compose up`, run migrations, and start instructions for both apps.
- [x] 8.3 Run `openspec validate scaffold-foundation --strict` and confirm the scaffold satisfies every `platform-foundation` scenario.
