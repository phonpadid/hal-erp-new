## MODIFIED Requirements

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
