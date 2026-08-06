## ADDED Requirements

### Requirement: Employee List Search and Filtering

The employee list SHALL accept an optional search term and optional filters alongside its
paging parameters, and SHALL apply them within the active company only.

The search term SHALL match case-insensitively as a substring against `employee.emp_code`,
`employee.full_name`, and `employee.position`; a record matching ANY of the three SHALL be
returned. A term that is empty or whitespace-only SHALL be treated as absent. `employee.salary`
SHALL NOT be searchable, because membership in a filtered result would otherwise disclose a
value gated by `EMP_SALARY_VIEW`.

The list SHALL accept optional filters on `employee.department_id`, `employee.status`, and
`employee.job_level`, and an optional filter on whether `employee.user_id` is set. Supplied
filters SHALL combine with the search term and with each other conjunctively (AND). A filter
value that is malformed — a `department_id` that is not a UUID, or a `status` outside
`ACTIVE` / `RESIGNED` / `TERMINATED` — SHALL be rejected rather than ignored.

Every parameter SHALL be optional: a request that supplies none SHALL return the same result
as before this capability existed. The reported total SHALL be the count of the matching set,
not of the unfiltered company registry. The active-company scope SHALL be applied before and
independently of any search or filter, so no search term or filter combination can return an
employee of another company.

#### Scenario: Search matches an employee code

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees with a search term equal to part of an
  `emp_code` in the active company
- **THEN** only employees whose `emp_code`, `full_name`, or `position` contains that term are
  returned

#### Scenario: Search is case-insensitive

- **GIVEN** an employee whose `full_name` is stored in mixed case
- **WHEN** an `EMPLOYEE_MANAGE` user searches using a different case of that name
- **THEN** the employee is returned

#### Scenario: A blank search term is ignored

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees with a search term that is empty or only
  whitespace
- **THEN** the full company registry is returned, as if no term had been supplied

#### Scenario: Filter by department

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees filtered by a `department_id` of the
  active company
- **THEN** only employees of that department are returned

#### Scenario: Filter by status

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees filtered by status `RESIGNED`
- **THEN** only employees whose `status` is `RESIGNED` are returned

#### Scenario: Filter by job level

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees filtered by a `job_level` code
- **THEN** only employees whose `job_level` equals that code are returned

#### Scenario: Filter by whether the employee has a login account

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees filtered to those without an account
- **THEN** only employees whose `user_id` is null are returned
- **AND** filtering to those with an account returns only employees whose `user_id` is set

#### Scenario: Search and filters combine

- **WHEN** an `EMPLOYEE_MANAGE` user supplies both a search term and a department filter
- **THEN** only employees of that department that also match the search term are returned

#### Scenario: The total reflects the filtered set

- **GIVEN** a company whose registry is larger than one page
- **WHEN** an `EMPLOYEE_MANAGE` user lists employees with a filter that matches fewer records
  than one page holds
- **THEN** the reported total is the count of matching employees, not the count of the whole
  company registry

#### Scenario: An unknown status filter is rejected

- **WHEN** an `EMPLOYEE_MANAGE` user filters by a status outside `ACTIVE` / `RESIGNED` /
  `TERMINATED`
- **THEN** the request is rejected, and no partially-filtered list is returned

#### Scenario: A malformed department filter is rejected

- **WHEN** an `EMPLOYEE_MANAGE` user filters by a `department_id` that is not a valid UUID
- **THEN** the request is rejected

#### Scenario: Search never crosses companies

- **GIVEN** two companies each holding an employee whose `full_name` contains the same term
- **WHEN** an `EMPLOYEE_MANAGE` user of one company searches for that term
- **THEN** only their own company's employee is returned

#### Scenario: Filters never widen the salary gate

- **WHEN** a user without `EMP_SALARY_VIEW` lists employees with any search term or filter
- **THEN** `salary` is absent from every returned record, exactly as in an unfiltered list

#### Scenario: An unparameterised list is unchanged

- **WHEN** an `EMPLOYEE_MANAGE` user lists employees supplying only paging parameters
- **THEN** the same employees are returned, in the same `emp_code` order, as before search and
  filtering existed
