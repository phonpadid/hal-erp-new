## MODIFIED Requirements

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
