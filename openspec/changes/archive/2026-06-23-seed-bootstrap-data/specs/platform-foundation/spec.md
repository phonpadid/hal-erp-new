## ADDED Requirements

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
