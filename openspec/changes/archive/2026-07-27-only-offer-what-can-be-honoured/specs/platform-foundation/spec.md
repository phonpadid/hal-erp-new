## ADDED Requirements

### Requirement: A DB-Backed Spec Does Not Depend On What Ran Before It

A DB-backed spec that removes rows from a shared table as part of its own setup SHALL build the schema it runs against, rather than adopting whatever schema and rows are already present in the test database.

The test database outlives a run. A spec that wipes a widely-referenced table — `app_user` above all — will fail on a foreign key held by a row some earlier run left behind, and every test in that file fails with it, reporting a database error that names nothing to do with what the file is testing. A spec SHALL NOT be able to fail for that reason.

#### Scenario: A spec that wipes a shared table starts from its own schema

- **GIVEN** a test database still holding rows from an earlier run
- **WHEN** a spec that clears a widely-referenced table runs
- **THEN** it builds its own schema first, and its tests fail or pass on their own merits
