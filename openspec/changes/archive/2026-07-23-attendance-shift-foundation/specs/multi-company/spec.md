## MODIFIED Requirements

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
