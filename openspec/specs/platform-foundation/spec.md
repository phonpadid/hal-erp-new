# Platform Foundation Specification

## Purpose
Scaffolding for the platform: the ORM entity layer mirroring the canonical DBML,
money-as-decimal discipline, append-only ledgers, company-scoped access, permission-code
authorization, JWT active-company context, DTO/UUID validation, test tooling, the
frontend UI/forms/state baseline, a shared validation schema seam, and a reproducible
local development environment. Every downstream capability builds on these.
## Requirements
### Requirement: ORM entities mirror the canonical DBML

The backend SHALL define a MikroORM entity for every one of the 37 tables in
`erp_approval_system.dbml`, using the exact table and column names from the DBML.
Every foreign key declared by a `Ref:` line SHALL be modeled as a MikroORM relation,
and the 5 DBML enums (`doc_status`, `budget_txn_type`, `doc_category`,
`approve_action`, `control_policy`) SHALL be represented as TypeScript enums backed by
their string values. An initial migration generated from these entities SHALL produce
a schema that matches the DBML.

#### Scenario: All tables have entities

- **WHEN** the entity layer is loaded by MikroORM metadata discovery
- **THEN** there is exactly one entity mapped to each of the 37 DBML tables, with the
  same table name and column names

#### Scenario: Foreign keys are relations

- **WHEN** an entity references another table per a DBML `Ref:` line (e.g.
  `budget_txn.budget_id > budget.id`)
- **THEN** the owning entity exposes a typed relation to the referenced entity using
  the same FK column

#### Scenario: Migration reproduces the schema

- **WHEN** the initial migration is run against an empty PostgreSQL database
- **THEN** the resulting schema diff against the entities is empty (no pending changes)

### Requirement: Money columns are decimal, never floating point

All monetary columns SHALL be mapped as MikroORM decimal columns and carried in
TypeScript as a string or Decimal type, never as a JavaScript number. This MUST apply
to every currency-bearing column in the DBML, including `budget.amount_total`,
`budget_txn.amount`, `budget_movement.amount`, `quota.limit_value`,
`quota_usage.qty_used`, `document_line.amount`, `document.amount`, and
`exchange_rate.rate`.

#### Scenario: Decimal round-trip preserves precision

- **WHEN** a monetary value such as `"1234567.89"` is persisted and re-read
- **THEN** the value returned is the exact string `"1234567.89"` with no float rounding

### Requirement: Append-only ledger entities

The `budget_txn` and `approval_log` entities SHALL be modeled as append-only. The
persistence layer SHALL provide insert-only access for these tables and SHALL NOT
expose update or delete operations for their rows.

#### Scenario: Ledger rows cannot be updated or deleted through the app

- **WHEN** application code attempts to update or delete a `budget_txn` or
  `approval_log` row
- **THEN** the operation is rejected by the ledger access guard rather than mutating
  the row

### Requirement: Company-scoped data access

The backend SHALL provide a company-scope mechanism that filters queries on
company-owned tables by the active `company_id` from the request context. Reads SHALL
default to the active company; cross-company reads SHALL be permitted only for
GROUP-scope, read-only access.

#### Scenario: Query is filtered to the active company

- **WHEN** an authenticated request with active company `A` lists rows of a
  company-scoped table
- **THEN** only rows where `company_id = A` are returned

#### Scenario: Cross-company write is blocked

- **WHEN** a request with active company `A` attempts to create or modify a row owned
  by company `B`
- **THEN** the request is rejected and no data crosses companies

### Requirement: Permission-code authorization

Authorization SHALL be enforced on permission **codes** (e.g. `DOC_PR_APPROVE`) carried
in the JWT, never on role names. The backend SHALL expose a guard/decorator that
protects an endpoint by required permission code(s).

#### Scenario: Endpoint requires a permission code

- **WHEN** a request without the required permission code calls a guarded endpoint
- **THEN** the request is rejected with a 403 before the handler runs

#### Scenario: Authorization ignores role names

- **WHEN** two companies define roles with the same name but different permission codes
- **THEN** access is decided by the permission codes granted, not by the role name

### Requirement: JWT carries active-company context

The authentication layer SHALL issue and validate a JWT that carries the
authenticated user, the active `company_id`, and the granted permission codes for that
company. Protected requests without a valid token SHALL be rejected.

#### Scenario: Unauthenticated request is rejected

- **WHEN** a request to a protected endpoint carries no valid JWT
- **THEN** the request is rejected with 401

#### Scenario: Token exposes active company and permissions

- **WHEN** a valid JWT is decoded by the auth layer
- **THEN** the request context exposes the user id, the active `company_id`, and the
  permission codes for that company

### Requirement: DTO validation and UUID parsing

Every request DTO SHALL be validated with class-validator via a global
`ValidationPipe` (whitelist + forbid non-whitelisted), and every UUID route parameter
SHALL be parsed/validated with `ParseUUIDPipe`.

#### Scenario: Invalid payload is rejected

- **WHEN** a request body fails its DTO validation rules
- **THEN** the request is rejected with 400 and a structured validation error

#### Scenario: Malformed UUID is rejected

- **WHEN** a route parameter typed as a UUID receives a non-UUID value
- **THEN** the request is rejected with 400 before reaching the handler

### Requirement: Backend test tooling

The backend SHALL use Vitest as the unit test runner and Playwright for end-to-end
tests. The default `test` script SHALL run the Vitest suite, and a sample passing test
SHALL be present so the harness is verifiable. DB-backed specs SHALL gate on a robust
database-availability check (bounded retry / adequate timeout) so a reachable database is
detected deterministically, and their fixtures SHALL be consistent with the canonical schema
constraints (unique keys and column precision) so the specs pass rather than failing in
`beforeAll`.

#### Scenario: Unit test runner executes

- **WHEN** the backend test script is run
- **THEN** Vitest discovers and runs the suite and the sample test passes

#### Scenario: DB-backed specs run when the database is reachable

- **WHEN** a reachable database is present and a DB-backed spec is run on a fresh process
- **THEN** the availability check detects it and the spec's tests execute rather than skipping

#### Scenario: Fixtures respect the canonical constraints

- **WHEN** a DB-backed spec seeds its fixtures
- **THEN** they honour the canonical unique keys and column precision (e.g. `user_company_role`'s
  `(user, company, role)` unique, `decimal(15,2)` amounts) and the spec's `beforeAll`/inserts succeed

### Requirement: Frontend UI, forms, and state baseline

The frontend SHALL be configured with PrimeVue 4 (styled mode, Aura preset,
`darkModeSelector: '.dark'`), PrimeIcons, Tailwind CSS with the `tailwindcss-primeui`
plugin, Pinia, and Vue Router. Forms SHALL be built with `@primevue/forms`
(`<Form>`/`<FormField>`) validated by a Zod schema via `zodResolver`. UI affordances
SHALL be gated by permission code from an active-company Pinia store, and the app SHALL
render correctly in both light and dark mode using theme tokens (no hardcoded colors).

#### Scenario: App mounts with PrimeVue theming

- **WHEN** the frontend dev build runs
- **THEN** the app mounts with the PrimeVue Aura theme applied and toggling the `.dark`
  selector switches between light and dark without hardcoded colors

#### Scenario: A form validates with a Zod resolver

- **WHEN** a sample `@primevue/forms` form is submitted with invalid input
- **THEN** the `zodResolver` reports the field error and the form does not submit

#### Scenario: UI is gated by permission code

- **WHEN** the active-company permission set in the Pinia store lacks a required
  permission code
- **THEN** the affordance guarded by that code is hidden or disabled

### Requirement: Shared validation schema seam

The project SHALL provide a shared location (e.g. a `shared/` package) for Zod schemas
so that a form's client-side schema and the corresponding backend DTO derive from a
single source of truth and do not drift. Every package that consumes those shared schemas
(the `shared` package itself, the backend, and the frontend) SHALL depend on the **same Zod
major version** so the schemas type-check identically everywhere and the frontend
type-check (`vue-tsc`) passes against the shared `zodResolver` forms.

#### Scenario: Client and server share one schema

- **WHEN** a validation rule is changed in the shared schema
- **THEN** both the frontend form and the backend DTO reflect the change without a
  separate edit on each side

#### Scenario: One Zod major across consumers

- **WHEN** the shared package, the backend, and the frontend resolve their `zod` dependency
- **THEN** they resolve to the same Zod major version, and `vue-tsc` type-checks the
  `zodResolver` forms without a version-mismatch error

### Requirement: Local development environment

The project SHALL provide a reproducible local environment: a `docker-compose` stack
for PostgreSQL and S3-compatible storage (MinIO), an `.env.example` documenting required
configuration, and README instructions to install dependencies, run migrations, and
start both apps.

#### Scenario: Stack starts from compose

- **WHEN** a developer runs the documented compose command
- **THEN** PostgreSQL and MinIO start and the backend can connect using the values from
  `.env.example`

### Requirement: Bootstrap Seed Data

The system SHALL provide an idempotent seeder that establishes a usable baseline on a
freshly migrated database: all permission codes, a demo company with departments and an
open fiscal year, currencies with at least one exchange rate, roles wired to permissions
via `role_permission`, demo users assigned to the company via `user_company_role` with
hashed passwords, and the document/budget/quota/workflow/notification configuration needed
to run an end-to-end flow. Running the seeder more than once SHALL NOT create duplicates.
The seeder SHALL NOT write append-only ledger rows (`budget_txn`, `approval_log`).

#### Scenario: Seeding makes the system loginable with resolved permissions

- **GIVEN** a freshly migrated, empty database
- **WHEN** the seeder runs
- **THEN** a demo user can authenticate and the issued company-context token carries the
  permission codes granted by that user's role

#### Scenario: Re-running the seeder is idempotent

- **WHEN** the seeder runs a second time
- **THEN** no duplicate permissions, users, roles, or configuration rows are created

#### Scenario: A budget-controlled document type is ready to submit

- **WHEN** the seed completes
- **THEN** a document type with `requires_budget`, a published form template, a
  department mapping, a workflow with an approver step, and a matching budget all exist, so
  a document of that type can be created, submitted, and routed

### Requirement: Paginated list endpoints

Every list endpoint (a `GET` that returns a collection) SHALL be server-paginated. It SHALL
accept `page` (1-based) and `limit` query parameters (validated; a sensible default when
omitted and a hard maximum `limit` to bound the page size) and SHALL return a paged envelope
`{ items, total, page, limit }`, where `total` is the count of all rows matching the query
(not just the returned page). Company scope (invariant 1) and any existing filters SHALL be
applied to the query **before** the page window, so `total` reflects the scoped/filtered set
and rows never leak across companies. The page window SHALL be produced by a single
count+slice over the database (e.g. MikroORM `findAndCount` with `offset`/`limit`), not by
slicing an already-materialized full result in memory.

#### Scenario: List returns a bounded page with a total

- **WHEN** a client requests a list with `page=1&limit=20`
- **THEN** at most 20 items are returned along with the full `total` of matching rows and the
  echoed `page` and `limit`

#### Scenario: Paging is applied after company scope and filters

- **GIVEN** rows exist in more than one company
- **WHEN** a paginated list is requested in the active company
- **THEN** only the active company's rows are counted and returned, and the page window is
  taken from that scoped/filtered set

#### Scenario: Limit is bounded

- **WHEN** a client requests a `limit` above the allowed maximum (or omits it)
- **THEN** the effective limit is clamped to the maximum (or the default) rather than
  returning an unbounded result

### Requirement: A spec's result does not depend on the day it runs

A spec SHALL produce the same result on every calendar day, so that a red suite always means a
real defect. A spec needing a date in the future SHALL derive one that satisfies the property it
is testing — a working day of the fixture's resolved shift, when the behaviour under test only
happens on working days — rather than assuming that tomorrow is such a day. Deriving an instant
from the clock remains permitted where the behaviour under test is itself relative to now, such
as a deduplication window; the prohibition is on letting the weekday of the run decide whether an
assertion is reachable.

#### Scenario: A leave spec asks for a future working date

- **GIVEN** a fixture employee whose department `default_work_shift` works Monday to Friday
- **WHEN** a spec files a leave request for a future date to prove the advance-notice rule
- **THEN** the date it chooses is one that shift works, so `count_leave_days` charges more than
  zero and the request reaches the advance-notice check the spec is asserting

#### Scenario: The suite runs on a Saturday

- **WHEN** the backend suite is run on a day whose following day is not a working day
- **THEN** it reports the same pass or fail result as it does on any other day

