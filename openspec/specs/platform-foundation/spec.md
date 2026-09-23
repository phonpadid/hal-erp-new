# Platform Foundation Specification

## Purpose
Scaffolding for the platform: the ORM entity layer mirroring the canonical DBML,
money-as-decimal discipline, append-only ledgers, company-scoped access, permission-code
authorization, JWT active-company context, DTO/UUID validation, test tooling, the
frontend UI/forms/state baseline, a shared validation schema seam, and a reproducible
local development environment. Every downstream capability builds on these.
## Requirements
### Requirement: ORM entities mirror the canonical DBML

The backend SHALL define a MikroORM entity for every table in `erp_approval_system.dbml`, using the exact table and column names from the DBML. The DBML SHALL be complete: a table that exists in the database and is not the ORM's own migration bookkeeping SHALL be declared there. Neither this requirement nor any other SHALL state how many tables there are — a count in prose goes stale silently and then reads as a rule.

Every foreign key declared by a `Ref:` line SHALL be modeled as a MikroORM relation, and the DBML enums (`doc_status`, `budget_txn_type`, `doc_category`, `approve_action`, `control_policy`) SHALL be represented as TypeScript enums backed by their string values. An initial migration generated from these entities SHALL produce a schema that matches the DBML.

#### Scenario: All tables have entities

- **WHEN** the entity layer is loaded by MikroORM metadata discovery
- **THEN** there is exactly one entity mapped to each DBML table, with the same table name and column names

#### Scenario: A table in the database is a table in the DBML

- **WHEN** the tables in a migrated database are compared with those declared in the DBML
- **THEN** the only difference is the ORM's own migration-bookkeeping table

#### Scenario: Foreign keys are relations

- **WHEN** an entity references another table per a DBML `Ref:` line (e.g.
  `budget_txn.budget_id > budget.id`)
- **THEN** the owning entity exposes a typed relation to the referenced entity using
  the same FK column

#### Scenario: Migration reproduces the schema

- **WHEN** the initial migration is run against an empty PostgreSQL database
- **THEN** the resulting schema matches the DBML tables, columns, and foreign keys

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

Every request body SHALL be validated with class-validator (whitelist + forbid non-whitelisted), including a body that arrives as a top-level array, and every UUID route parameter SHALL be parsed/validated with `ParseUUIDPipe`.

The global `ValidationPipe` treats a top-level array as a native type and does not validate it, so an endpoint whose body is an array SHALL declare the element class explicitly, with the same whitelist and forbid-non-whitelisted settings as the global pipe. The same element class SHALL therefore be enforced identically whether it arrives nested inside another DTO or as the whole body — a rule that holds on create and not on update is a rule the caller cannot rely on.

#### Scenario: Invalid payload is rejected

- **WHEN** a request body fails its DTO validation rules
- **THEN** the request is rejected with 400 and a structured validation error

#### Scenario: Malformed UUID is rejected

- **WHEN** a route parameter typed as a UUID receives a non-UUID value
- **THEN** the request is rejected with 400 before reaching the handler

#### Scenario: An element of an array body is missing a required field

- **GIVEN** an endpoint whose body is an array of a validated element class
- **WHEN** one element omits a field that class requires
- **THEN** the request is rejected with 400 naming the field, and nothing is written

#### Scenario: An element of an array body carries an unknown field

- **GIVEN** an endpoint whose body is an array of a validated element class
- **WHEN** one element carries a field the class does not declare
- **THEN** the request is rejected with 400, as it would be for the same field on a non-array body

#### Scenario: The body is not an array at all

- **GIVEN** an endpoint whose body is an array
- **WHEN** the caller sends something that is not one
- **THEN** the request is rejected with 400 before reaching the handler

### Requirement: Backend test tooling

The backend SHALL use Vitest as the unit test runner and Playwright for end-to-end
tests. The default `test` script SHALL run the Vitest suite, and a sample passing test
SHALL be present so the harness is verifiable. DB-backed specs SHALL gate on a robust
database-availability check (bounded retry / adequate timeout) so a reachable database is
detected deterministically, and their fixtures SHALL be consistent with the canonical schema
constraints (unique keys and column precision) so the specs pass rather than failing in
`beforeAll`.

The end-to-end suite SHALL drive the document lifecycle against a running API and a real
database, and SHALL cover **every active `document_type` of the company it runs against**, through
each of the four ways a document ends: approved to `COMPLETED`, rejected, withdrawn by its author,
and returned then resubmitted. The set of types it claims to cover SHALL be written down, and a
check SHALL fail when that set no longer equals the company's active types, so a type added to a
company is reported as uncovered rather than silently going untested.

The suite SHALL provision its own fixtures through the public API and SHALL NOT depend on any
particular company's configuration: its own `department`, its own accounts for a requester and at
least two approvers (an author who is not an approver, because no self-approval is enforced), its
own `workflow` and `workflow_step` rows, a `dept_doc_type` mapping per document type, and its own
`budget_node` and `budget` rows. A `budget` the suite spends against SHALL reach `ACTIVE` by the
route the product provides — drafted, carried on a `BUDGET_PLAN` document, approved — so it is
governed by the `budget_control_point` that route mints; the suite SHALL NOT write the status
directly, because a fixture in a state the product cannot produce proves nothing about the product.

Provisioning SHALL be idempotent, so a second run reuses what the first left behind rather than
building a rival sandbox.

Ledger assertions SHALL compare money as decimal strings and SHALL NOT coerce an amount to a
JavaScript number: a base currency whose `currency.decimal_places` is 0 is carried in a
`numeric(15,2)` column, so the same money is returned with and without a fractional part and only a
decimal comparison recognises the two as equal.

The suite SHALL assert the two concurrency points the design names, by issuing genuinely concurrent
requests rather than by inspection: concurrent document creations SHALL each receive a distinct
`document.doc_no`, and concurrent submissions competing for the last of a `budget` SHALL leave
exactly one `budget_txn` `RESERVE` row, the loser refused with the over-budget code.

End-to-end runs SHALL execute with a single worker, because the budget assertions are before/after
comparisons against a shared append-only ledger and a second worker moving the same `budget` would
make a correct implementation report as wrong.

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

#### Scenario: Every active document type is exercised end to end

- **WHEN** the end-to-end suite runs against a company
- **THEN** each active `document_type` is created, submitted, approved to `COMPLETED`, and
  separately rejected, withdrawn, and returned-then-resubmitted

#### Scenario: A document type nobody covered is reported

- **GIVEN** a company that gains an active `document_type` the suite does not name
- **WHEN** the suite runs
- **THEN** the coverage check fails, naming the type, rather than the run passing with one type
  untested

#### Scenario: The suite builds its own sandbox

- **WHEN** the end-to-end suite runs against a database whose `dept_doc_type` rows map none of the
  company's document types to any department
- **THEN** it provisions its own department, accounts, workflow, mappings and budgets through the
  public API and the flows run, without changing any existing department's configuration

#### Scenario: A spendable budget was put in force the way the product does it

- **WHEN** the suite provisions a `budget` for a flow to charge
- **THEN** that budget reached `status` `ACTIVE` through an approved `BUDGET_PLAN` document and is
  covered by a `budget_control_point`

#### Scenario: Running the suite twice does not build a second sandbox

- **GIVEN** a database the suite has already run against
- **WHEN** it runs again
- **THEN** it reuses the existing department, accounts, workflow, mappings and budgets

#### Scenario: Concurrent creations get distinct document numbers

- **WHEN** several document creations are issued concurrently for one document type
- **THEN** every returned `document.doc_no` is distinct

#### Scenario: Concurrent submissions cannot over-commit a budget

- **GIVEN** two drafts whose amounts together exceed a `budget`'s available balance while either
  alone fits
- **WHEN** both are submitted concurrently
- **THEN** exactly one succeeds, the other is refused with the over-budget code, and exactly one
  `budget_txn` `RESERVE` row exists across the two documents

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

The API origin the front-end is configured to call and the port the backend is configured to listen
on SHALL be checkable for agreement by a documented command, which SHALL fail and name both values
when they disagree.

Both values live in gitignored `.env` files, so they drift per machine while the committed
configuration stays consistent. When they do, every request fails at the network layer and the
login screen reports a connection error that names neither file — the reader has no way to tell a
misconfigured port from a backend that is not running.

The boot check SHALL additionally report how many active document types cannot be raised by any
department, WITHOUT failing on them. A company part-way through rollout legitimately has unmapped
types, so this is not an error; but a database in which nobody can raise anything is a state worth
never discovering by accident, and the count makes it visible at every deploy.

#### Scenario: Stack starts from compose

- **WHEN** a developer runs the documented compose command
- **THEN** PostgreSQL and MinIO start and the backend can connect using the values from
  `.env.example`

#### Scenario: The documented defaults agree

- **GIVEN** a freshly checked-out repository configured per the README and `.env.example`
- **WHEN** the documented check is run
- **THEN** it passes, and starting both apps lets the login form reach the backend

#### Scenario: A disagreeing pair is reported

- **GIVEN** a configuration whose front-end API origin names a port the backend does not bind
- **WHEN** the documented check is run
- **THEN** it fails and names both values

#### Scenario: Unraisable types are counted, not fatal

- **GIVEN** a database with active document types that no department maps
- **WHEN** the boot check is run
- **THEN** it reports how many, and still exits zero

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

A paginated endpoint SHALL impose a TOTAL order on its query — an ordering that no two rows tie
on — so that paging it end to end returns every matching row exactly once.

Without one, the database is free to return each `LIMIT`/`OFFSET` query in a different order, and
the pages then overlap and leave gaps: some rows appear on two pages and others on none. The budget
list shipped this way, and paging the customer's 496 rows returned 7 of them twice while others
could not be reached at all. It is invisible on a dataset that fits one page, invisible to a type
check, and invisible to any test that reads only the first page — a reader simply never finds a row
they know exists. Ordering by a meaningful column is not sufficient on its own where that column can
tie; a unique tiebreaker SHALL follow it.

A list endpoint MAY accept a free-text `search` term. Where it does, the term SHALL be applied to
the query **before** the page window, like every other filter, so `total` counts the matches and a
match on any page is reachable from the first. The term SHALL narrow the already-scoped set and
SHALL NOT widen it: it cannot reach a row that company scope, permission scope or an existing
filter excluded.

An endpoint SHALL NOT accept a `search` term it does not apply. Declaring the parameter on the
shared pagination DTO would make every list endpoint accept one and silently drop it, which is the
same falsehood as a search box wired to nothing — the caller is told the request was understood.
The parameter therefore belongs to a searchable variant of that DTO, used only by endpoints that
implement it.

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

#### Scenario: Paging end to end reaches every row exactly once

- **GIVEN** a list holding more rows than one page
- **WHEN** a client requests every page in turn
- **THEN** each matching row is returned exactly once, and none is missed

#### Scenario: The same page twice returns the same rows

- **GIVEN** a list whose underlying data has not changed
- **WHEN** the same page is requested twice
- **THEN** the same rows are returned in the same order

#### Scenario: A search term is applied before the page window

- **GIVEN** a list whose matching rows would fall on a later page unfiltered
- **WHEN** it is requested with a search term and `page=1`
- **THEN** the matches are returned on the first page and `total` is the count of matches

#### Scenario: A search term cannot reach another company's rows

- **GIVEN** a row in another company whose text matches the term
- **WHEN** a list is searched from the active company
- **THEN** that row is neither returned nor counted

### Requirement: A spec's result does not depend on the day it runs

A spec SHALL produce the same result on every calendar day **and at every hour of it**, so that a red suite always means a real defect.

A spec needing a date in the future SHALL derive one that satisfies the property it is testing — a working day of the fixture's resolved shift, when the behaviour under test only happens on working days — rather than assuming that tomorrow is such a day.

A fixture's date SHALL be stated absolutely, unless a rule under test measures that date against now — a rolling window, an eligibility period, an age — in which case it SHALL be derived from now, so the distance the rule measures stays fixed. An absolute date read by a rolling window is correct on the day it is written and wrong from then on, which is worse than a spec that never passed: it decays quietly, and a red line that everyone has learned to ignore is where the next real defect hides.

Where a fixture states a calendar day that a rule evaluates in a company's own timezone, it SHALL derive that day in the same timezone the rule uses. The server's UTC day is a different day for part of every day, so a fixture built from it holds only for the hours the two happen to agree.

Deriving an instant from the clock remains permitted where the behaviour under test is itself relative to now, such as a deduplication window; the prohibition is on letting the weekday, the date, or the hour of the run decide whether an assertion is reachable.

#### Scenario: A leave spec asks for a future working date

- **GIVEN** a fixture employee whose department `default_work_shift` works Monday to Friday
- **WHEN** a spec files a leave request for a future date to prove the advance-notice rule
- **THEN** the date it chooses is one that shift works, so `count_leave_days` charges more than
  zero and the request reaches the advance-notice check the spec is asserting

#### Scenario: The suite runs on a Saturday

- **WHEN** the backend suite is run on a day whose following day is not a working day
- **THEN** it reports the same pass or fail result as it does on any other day

#### Scenario: A spec asserts a refusal that a rolling window would pre-empt

- **GIVEN** a rule that refuses a date older than a rolling window, checked before the refusal a spec is asserting
- **WHEN** the spec builds the date it submits
- **THEN** it derives that date from today, so the assertion it is making is still the one reached however long after it was written the spec is run

#### Scenario: A spec builds a date a rule reads in the company's timezone

- **GIVEN** a rule that evaluates a date on the company's local day
- **WHEN** a spec builds that date
- **THEN** it derives it in the company's timezone, and the spec reports the same result at every hour of the day

#### Scenario: The suite runs before the local day and the UTC day agree

- **WHEN** the backend suite is run at an hour where the server's UTC day differs from the company's local day
- **THEN** it reports the same pass or fail result as it does at any other hour

### Requirement: Every error response carries a stable code

Every error response SHALL carry a `code` field naming the failure in a form a machine can branch on, alongside the existing `statusCode`, `message` and `error` fields, whose shape and meaning SHALL be unchanged. `message` SHALL remain the human-readable text — a string, or the array the DTO validator produces — because it is what the web app displays. A caller SHALL never have to read `message` to decide what to do.

The `code` SHALL be stable: it SHALL NOT change when the message is reworded. An exception that names no code SHALL receive one derived from its HTTP status, so that a response is never without one and existing throw sites need no edit.

#### Scenario: A coded failure names itself

- **WHEN** an operation fails for a reason a caller must act on
- **THEN** the response carries the `code` for that reason, and its `message` still describes the failure in English

#### Scenario: An uncoded failure still carries a code

- **WHEN** an exception that names no code is thrown
- **THEN** the response carries a code derived from the HTTP status, and every other field of the body is exactly what it was before this requirement existed

#### Scenario: The validator's array survives

- **WHEN** a request fails DTO validation
- **THEN** `message` is still the array of validation strings the web app joins for display, and the response additionally carries the validation code

### Requirement: Codes name the situations a caller acts on differently

The named codes SHALL be chosen by what a caller does in response, not by what can throw. The system SHALL distinguish at least: a budget that refused a reservation, a quota that refused one, an operation that does not apply to the document's current state, and a payload that failed validation. Each of these SHALL be raised where the decision is made, so that any caller of that path receives it — including paths written later.

A code SHALL NOT be added for a failure nobody branches on; a generic derived code is the correct answer there, and MAY change.

#### Scenario: A hard-stop budget refuses a reservation

- **GIVEN** a document whose submit would exceed a `HARD_STOP` budget
- **WHEN** it is submitted
- **THEN** the response names the budget-exceeded code, and nothing is reserved

#### Scenario: A hard-stop quota refuses a reservation

- **WHEN** a submit would exceed a `HARD_STOP` quota
- **THEN** the response names the quota-exceeded code, distinctly from the budget one, because what has to be topped up is different

#### Scenario: The document is in the wrong state

- **WHEN** an operation is attempted on a document whose status does not permit it
- **THEN** the response names the invalid-state code, so a caller can stop rather than retry

#### Scenario: The same refusal from a path added later

- **GIVEN** a new endpoint that reserves budget through the existing ledger
- **WHEN** its reservation is refused by a hard stop
- **THEN** it returns the budget-exceeded code without that endpoint having done anything to opt in

### Requirement: The Seeded Finance Roles Can Record A Payment

The seeded baseline SHALL grant the finance roles the permissions that read the ready-to-pay queue and record a payment against it, so that a freshly seeded system can carry a payable from approval to payment without the administrator account.

The seeded baseline SHALL NOT grant those roles the permission to delete a payment slip. A slip is the audit record of a payment, and the authority to record one is a separate decision from the authority to destroy the evidence of one; a company that wants them held by the same people SHALL grant that deliberately rather than inherit it.

#### Scenario: Finance can reach its own worklist

- **GIVEN** a freshly seeded database
- **WHEN** a user holding the finance role reads the ready-to-pay queue
- **THEN** the list is returned rather than refused

#### Scenario: Finance can close out an approved disbursement

- **GIVEN** a fully approved document awaiting payment
- **WHEN** a user holding the finance role records the payment
- **THEN** the payment is recorded

#### Scenario: Recording is not permission to erase

- **GIVEN** a freshly seeded database
- **WHEN** the finance roles' permissions are examined
- **THEN** they carry no permission to delete a payment slip

### Requirement: A DB-Backed Spec Does Not Depend On What Ran Before It

A DB-backed spec that removes rows from a shared table as part of its own setup SHALL build the schema it runs against, rather than adopting whatever schema and rows are already present in the test database.

The test database outlives a run. A spec that wipes a widely-referenced table — `app_user` above all — will fail on a foreign key held by a row some earlier run left behind, and every test in that file fails with it, reporting a database error that names nothing to do with what the file is testing. A spec SHALL NOT be able to fail for that reason.

#### Scenario: A spec that wipes a shared table starts from its own schema

- **GIVEN** a test database still holding rows from an earlier run
- **WHEN** a spec that clears a widely-referenced table runs
- **THEN** it builds its own schema first, and its tests fail or pass on their own merits

### Requirement: A Constraint The Entities Express Is Enforced By The Database

Where an entity constrains a column — a fixed set of permitted values, or a value that must be present — the deployed schema SHALL carry that constraint too.

A rule held in one layer only is not enforced, it is intended. The specs build their schema from the entities and the deployed database is built from the migrations, so a constraint the migrations never learned about is absent from precisely the database that matters, and absent in a way no passing test can reveal.

In particular: a column whose entity declares a fixed set of values SHALL reject a value outside that set, and a column whose entity supplies a default and permits no absence SHALL reject an absent one. Closing such a difference SHALL NOT rewrite existing data — where existing rows would violate the constraint, that is a finding about the data and SHALL be decided on its own terms rather than repaired inside the migration that adds the constraint.

#### Scenario: A status outside the declared set is refused

- **GIVEN** a column whose entity declares a fixed set of statuses
- **WHEN** a value outside that set is written directly to the database
- **THEN** the write is rejected

#### Scenario: An amount the entity always supplies cannot be absent

- **GIVEN** a column whose entity supplies a default and does not permit absence
- **WHEN** a row is written without a value for it
- **THEN** the stored value is the default rather than an absent one

#### Scenario: Closing the difference leaves the data alone

- **WHEN** a migration adds a constraint the entities already expressed
- **THEN** no existing row's values are changed by it

### Requirement: A Refusal From Below The DTO Layer Is Not Reported As A Server Fault

A data-validation failure raised by the persistence layer SHALL be answered as a problem with the request — 400, carrying the validation code — and SHALL NOT be answered as an internal server error.

Not every bad payload is stopped by DTO validation: a value can pass its decorators and still be refused when the entity is built. Reporting that as a server fault tells the caller the opposite of the truth, and the code it carries is the one an integration is told to retry or escalate on, so the misattribution costs the caller a wrong action rather than only a wrong word.

The response body SHALL keep the shape every other error has — `statusCode`, `message`, `error`, `code` — and its `message` SHALL name what was missing or wrong, because a 400 that does not say which field is no more actionable than the 500 it replaces.

Such a failure SHALL still be recorded in the server log, because the same shape can also mean the system itself failed to set a required value, and after this rule the response alone no longer distinguishes the two. Genuine faults SHALL continue to answer 500 with a message that reveals nothing.

#### Scenario: A payload the DTO layer let through is refused when the row is built

- **WHEN** a request reaches the persistence layer and is refused there for a missing or invalid value
- **THEN** the response is 400 with the validation code, and names the value

#### Scenario: The caller is not told to escalate

- **WHEN** such a refusal is answered
- **THEN** the response does not carry the internal-error code

#### Scenario: A genuine fault is unchanged

- **WHEN** an error that is not a data-validation failure escapes a handler
- **THEN** the response is still 500 with the internal-error code and a message that reveals nothing, and the fault is logged

#### Scenario: The misattributed case stays visible

- **WHEN** such a refusal is answered as 400
- **THEN** it is still recorded in the server log, so a failure the system itself caused is not hidden by the status it now returns

### Requirement: A Refusal May Carry A Message Key The Client Translates

An error response SHALL be allowed to carry, alongside `code`, a `messageKey` and a `params` object. `messageKey`
SHALL name the *sentence* a person is shown — stable across rewordings and across languages — and
`params` SHALL carry the values that sentence names (a document-type code, a step number, a
status), so a client can render the refusal in the reader's language with the same facts the
English `message` states. `message` SHALL remain the English text, unchanged in meaning, for logs,
API clients and any client that does not know the key.

`messageKey` is distinct from `code` and SHALL NOT be used in its place: `code` names a situation a
caller *acts on* differently and is a contract; `messageKey` names how a refusal is *worded* and
MAY be added freely to any throw whose text a person reads. An exception that names no key SHALL
produce a response with no `messageKey`, and every other field exactly as before.

`params` SHALL carry names and codes people recognise (`typeCode`, `stepNo`, `status`), never a
database id; a message that can only name an id is a message that names nothing.

#### Scenario: A keyed refusal carries its facts

- **WHEN** a configuration write is refused because document type `CLAIM_RECOVERY` would be left
  without a settlement
- **THEN** the response carries `messageKey` for that refusal, `params.typeCode` = `CLAIM_RECOVERY`,
  the English `message`, and its `code` unchanged

#### Scenario: An unkeyed refusal is untouched

- **WHEN** an exception that names no message key is thrown
- **THEN** the response has no `messageKey` or `params`, and every other field is what it was

#### Scenario: A key never replaces a code

- **GIVEN** a refusal that already carries a code a caller branches on (`SIGNATURE_REQUIRED`)
- **WHEN** it is given a message key
- **THEN** the response carries both, and the code is what it was
