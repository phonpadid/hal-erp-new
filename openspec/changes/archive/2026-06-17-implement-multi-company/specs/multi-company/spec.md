## ADDED Requirements

### Requirement: Company Deactivation

A company SHALL be deactivated by setting `company.is_active = false` and SHALL NOT be
hard-deleted, so historical records that reference it stay intact. Deactivated
companies MUST be excluded from default lists but remain retrievable by id.

#### Scenario: Deactivate instead of delete

- **WHEN** an administrator with `COMPANY_MANAGE` removes a company
- **THEN** the row is retained with `is_active = false` and no `company` row is deleted

#### Scenario: Deactivated companies are hidden from the default list

- **WHEN** a user with `COMPANY_VIEW` lists companies without an explicit include-inactive flag
- **THEN** companies with `is_active = false` are omitted from the result

### Requirement: Fiscal Year Close

The system SHALL provide an operation that transitions a `fiscal_year` from `OPEN` to
`CLOSED`, guarded by `FISCAL_YEAR_MANAGE`. Closing SHALL be idempotent-safe: closing an
already `CLOSED` year MUST be rejected rather than silently re-applied. The system SHALL
expose a period guard that rejects budget-consuming work dated inside a `CLOSED` year
(consumed by the budget and document capabilities).

#### Scenario: Close an open fiscal year

- **WHEN** a user with `FISCAL_YEAR_MANAGE` closes a fiscal year whose `status` is `OPEN`
- **THEN** its `status` becomes `CLOSED`

#### Scenario: Reject posting into a closed year

- **WHEN** the period guard is asked to validate a date that falls within a `CLOSED`
  fiscal year of the active company
- **THEN** it MUST reject with a closed-period error

### Requirement: Department Cycle Prevention

The department tree (`department.parent_dept_id`) SHALL remain acyclic. The system MUST
reject any create or reparent operation that would make a department its own ancestor,
and MUST reject a `parent_dept_id` belonging to a different company.

#### Scenario: Reject a parent that creates a cycle

- **WHEN** a user reparents department A under department B where B is already a
  descendant of A
- **THEN** the operation MUST be rejected and the tree is left unchanged

#### Scenario: Reject a cross-company parent

- **WHEN** a department in company A is given a `parent_dept_id` that belongs to company B
- **THEN** the operation MUST be rejected (invariant: company isolation)

### Requirement: Authorized, Company-Scoped Endpoints

Every multi-company endpoint SHALL authorize on a permission code (never a role name)
and SHALL apply the active-company scope to company-owned resources (`department`,
`fiscal_year`, `holiday_calendar`). Reads return only rows of the active company; writes
that target another company MUST be rejected.

#### Scenario: Missing permission code is forbidden

- **WHEN** a request without `DEPARTMENT_MANAGE` calls the create-department endpoint
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Reads are limited to the active company

- **WHEN** a user whose active company is A lists departments
- **THEN** only departments where `company_id = A` are returned

#### Scenario: UUID path parameters are validated

- **WHEN** a request supplies a non-UUID value for a company-owned resource id
- **THEN** it is rejected with 400 before the handler runs
