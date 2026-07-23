# Multi-Company Specification

## Purpose
Organizational backbone: legal entities (companies), their department trees, fiscal
years, and holiday calendars. Every other capability is scoped by `company_id`.

## Requirements

### Requirement: Company Registry
The system SHALL store each legal entity in the `company` table with name (TH/EN), tax id, branch code, base currency, and `timezone`. All main records MUST reference a company. `timezone` SHALL hold an IANA time-zone name (for example `Asia/Bangkok` or `Asia/Vientiane`), SHALL be validated against the time zones the runtime recognises, and SHALL be non-null for every company. `timezone` defines the zone in which that company's calendar days begin and end, so any capability that decides which day a moment belongs to resolves it against the company rather than assuming UTC.

#### Scenario: Create a company
- GIVEN an administrator with `COMPANY_MANAGE` permission
- WHEN they create a company with tax id and base currency THB
- THEN the company is persisted with a unique code
- AND its base currency MUST reference an active row in `currency`

#### Scenario: A company declares its time zone
- GIVEN an administrator with `COMPANY_MANAGE` permission
- WHEN they create a company with `timezone` `Asia/Bangkok`
- THEN the company is persisted with that zone
- AND day boundaries for that company are reckoned in it

#### Scenario: An unrecognised time zone is rejected
- WHEN a `COMPANY_MANAGE` user sets `timezone` to a value the runtime does not recognise as an IANA zone
- THEN the request is rejected and the company's zone is unchanged

#### Scenario: Existing companies carry a time zone after migration
- GIVEN companies created before `timezone` existed
- WHEN the schema migration runs
- THEN every existing company holds a non-null `timezone`

### Requirement: Department Tree
The system SHALL support an unlimited-depth department hierarchy per company via `department.parent_dept_id`, each with an optional cost center and an optional `default_work_shift_id`. When `default_work_shift_id` is set it MUST reference a `work_shift` in the same company, and it supplies the shift expected of employees in that department who carry no individual assignment.

#### Scenario: Nest a department under a parent
- GIVEN an existing parent department in company A
- WHEN a child department is created with `parent_dept_id` set to the parent
- THEN the child belongs to the same company as the parent
- AND a department MUST NOT reference a parent in a different company

#### Scenario: Set a department default shift
- GIVEN a `work_shift` in company A
- WHEN a department in company A sets `default_work_shift_id` to that shift
- THEN the department stores the default
- AND employees of that department with no individual assignment resolve to it

#### Scenario: A default shift from another company is rejected
- WHEN a department sets `default_work_shift_id` to a `work_shift` belonging to a different company
- THEN the request is rejected and the department is unchanged

### Requirement: Fiscal Year per Company
The system SHALL let each company define its own fiscal years with start/end dates
and an OPEN or CLOSED status; fiscal years of different companies MAY differ.

#### Scenario: Block posting into a closed year
- GIVEN a fiscal year in CLOSED status
- WHEN a user attempts to create a budget-consuming document dated within it
- THEN the system MUST reject the document with a closed-period error

### Requirement: Holiday Calendar
The system SHALL store per-company holidays used to compute working-day SLA.

#### Scenario: SLA skips holidays and weekends
- GIVEN a workflow step with `sla_hours` of 16 working hours
- WHEN the elapsed window spans a weekend and a company holiday
- THEN those non-working days MUST be excluded from the SLA countdown

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

### Requirement: Upload Company Profile Image
The system SHALL expose an authenticated endpoint, guarded by the `COMPANY_MANAGE`
permission code, that sets a company's 1:1 profile image (logo). The image bytes SHALL be
sent to the backend (multipart), which validates the mime type against the allow-list
(`image/png`, `image/jpeg`, `image/webp`) and enforces the size cap on the received bytes,
then writes them to object storage (S3/MinIO) server-side; the browser SHALL NOT PUT the
bytes directly to the bucket. Only the resulting object key SHALL be persisted on
`company.profile_image_path`; the raw bytes SHALL NOT be stored in the database. Reads SHALL
continue to return a short-lived presigned download URL for the current image, or null when
none is set.

#### Scenario: Admin sets a company logo
- **GIVEN** a user with `COMPANY_MANAGE`
- **WHEN** they post a PNG image to the company profile-image upload endpoint
- **THEN** the backend writes the bytes to object storage and sets `company.profile_image_path`
  to the stored object key
- **AND** the response returns a short-lived presigned URL for the new image
- **AND** no image bytes are stored in the database

#### Scenario: Oversized or disallowed company image is rejected
- **WHEN** a file exceeding the size cap or with a mime type not in the allow-list is posted
- **THEN** the request is rejected with a validation error and `company.profile_image_path`
  is unchanged and no object is written

#### Scenario: Upload requires COMPANY_MANAGE
- **GIVEN** a user without the `COMPANY_MANAGE` permission code
- **WHEN** they call the company profile-image upload endpoint
- **THEN** the request is rejected by the permission guard and no object is written
