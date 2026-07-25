## ADDED Requirements

### Requirement: The permission catalog matches the codes the application declares

The `permission` table SHALL contain a row for every permission code the application enforces, so that a code named by an authorization guard can be listed and granted. The system SHALL provide a command that reconciles the catalog to the declared codes by inserting the rows that are missing, and that command SHALL write nothing outside the `permission` table. Reconciliation SHALL be additive: a row whose code is no longer declared SHALL be left in place rather than deleted or deactivated.

#### Scenario: A slice introduces new permission codes

- **GIVEN** an environment whose `permission` table predates a slice that declares new codes
- **WHEN** the reconcile command runs
- **THEN** a row is inserted for each newly declared code, and no company, user, role, document type, or other record is created

#### Scenario: Reconciling twice changes nothing the second time

- **WHEN** the reconcile command runs against an environment whose catalog is already complete
- **THEN** no row is inserted, updated, or removed

#### Scenario: A code disappears from the source

- **GIVEN** a `permission` row whose code the application no longer declares
- **WHEN** the reconcile command runs
- **THEN** the row is left untouched, and any `role_permission` grant referencing it remains valid

### Requirement: A short permission catalog is detectable without changing it

The system SHALL provide a read-only command that compares the declared permission codes against the rows in the `permission` table and fails when any declared code has no row, naming the missing codes. The command SHALL make no writes, so it can be used to ask what an environment is missing without altering it.

#### Scenario: The catalog is missing codes

- **WHEN** the check command runs against an environment whose catalog is short
- **THEN** it exits non-zero and lists every declared code that has no row

#### Scenario: The catalog is complete

- **WHEN** the check command runs against an environment whose catalog is complete
- **THEN** it exits zero
