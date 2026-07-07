## ADDED Requirements

### Requirement: Company-Scoped Account Master

The system SHALL maintain a chart of accounts in a new `account` table scoped by
`company_id`. Each account SHALL have a `code`, a `name`, an `account_type`
(`ASSET` | `LIABILITY` | `EQUITY` | `REVENUE` | `EXPENSE`), an optional `parent_id`
(self-reference for hierarchy), an `is_postable` flag, and an `is_active` flag. `code`
SHALL be unique per company (`(company_id, code)` unique). Accounts SHALL NOT leak across
companies (invariant 1).

#### Scenario: Account code is unique within a company

- **WHEN** an account with `code` `5000` already exists for a company and another `5000`
  is created for the same company
- **THEN** the second creation is rejected as a duplicate

#### Scenario: Same code allowed in a different company

- **WHEN** company A has an account `5000` and company B creates `5000`
- **THEN** both are accepted, each scoped to its own company

#### Scenario: Accounts are company-isolated on read

- **WHEN** a user with the active company A lists accounts
- **THEN** only company A's accounts are returned, never company B's

### Requirement: Account Type and Hierarchy Integrity

An account's `parent_id`, when set, MUST reference an account in the same company. The
hierarchy MUST NOT contain cycles. A `parent_id` MUST reference an account whose
`account_type` matches the child's `account_type`. An account marked `is_postable = false`
represents a summary/header node and MUST NOT be selectable as a postable GL account.

#### Scenario: Parent must be same company and type

- **WHEN** an `EXPENSE` account is created with a `parent_id` pointing at a `REVENUE`
  account, or at an account in another company
- **THEN** the creation is rejected

#### Scenario: Cycles are rejected

- **WHEN** an update would make an account its own ancestor
- **THEN** the update is rejected

### Requirement: Postable-Account Resolution Contract

The system SHALL expose a resolver that maps a GL account reference (code or id) to an
account and SHALL reject the reference when the account is missing, `is_active = false`,
`is_postable = false`, or belongs to another company. Other capabilities SHALL call this
resolver to validate a GL account before persisting it.

#### Scenario: Resolves an active postable account

- **WHEN** a caller resolves code `5000` which is active and postable in the active company
- **THEN** the matching `account` is returned

#### Scenario: Rejects an inactive or non-postable account

- **WHEN** a caller resolves a code whose account is inactive, non-postable, or in another
  company
- **THEN** the resolution is rejected with a 400 naming the offending code

### Requirement: Authorized, Company-Scoped Account Administration

The system SHALL let users with `COA_MANAGE` create and update accounts and SHALL expose a
read-only list/detail query gated by `COA_VIEW`. Authorization SHALL use these permission
codes, never role names (invariant 6). Every account operation SHALL be scoped to the
caller's active company.

#### Scenario: Managing accounts is permission-gated

- **WHEN** a request without `COA_MANAGE` tries to create or update an account
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Viewing accounts is permission-gated

- **WHEN** a request without `COA_VIEW` requests the account list
- **THEN** it is rejected with 403

### Requirement: Deactivation Instead of Deletion

Accounts SHALL be deactivated by setting `is_active = false` and SHALL NOT be hard-deleted,
so existing `budget` and `item` references stay intact. A deactivated account MUST NOT be
selectable as a GL account on new budgets or items.

#### Scenario: Deactivate instead of delete

- **WHEN** an administrator removes an account
- **THEN** the `account` row is retained with `is_active = false` and no row is deleted

#### Scenario: A deactivated account cannot be chosen

- **WHEN** a new budget or item tries to reference a deactivated account
- **THEN** the reference is rejected
