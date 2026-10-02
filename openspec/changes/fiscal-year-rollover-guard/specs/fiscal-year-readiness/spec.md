## ADDED Requirements

### Requirement: Next-Year Readiness Read

The system SHALL expose a read that reports, for the active company, how ready the fiscal year
following the current one is. "Current" is the `fiscal_year` whose `start_date`..`end_date` covers
today in the company's `company.timezone`; "next" is the company's `fiscal_year` whose `start_date`
is the day after the current year's `end_date`. The read SHALL return:

- the current year's `year` and `end_date`, and the whole days remaining until `end_date`;
- whether the next fiscal year exists, and its `status`;
- the count of `budget` rows with `status = 'ACTIVE'` whose `fiscal_year_id` is the next year;
- the count of (`quota_id`, `employee_id`) pairs, for the company's quotas with `reset_cycle`
  other than `NONE`, that hold a `quota_entitlement` for the current year's `year` but none for the
  next year's `year`;
- whether an `exchange_rate` of type `BUDGET_RATE` dated inside the next year exists (informational:
  it SHALL NOT count toward readiness);
- an overall `ready` flag that is true only when the next year exists and is `OPEN`, holds at
  least one `ACTIVE` budget, and no per-person entitlement is missing.

The read SHALL be authorized by any one of `FISCAL_YEAR_MANAGE`, `BUDGET_MANAGE` or `QUOTA_MANAGE`
and SHALL be scoped to the active company (invariant 1). It SHALL return counts and flags only,
never budget amounts.

#### Scenario: Nothing prepared yet

- **WHEN** an admin reads readiness on 2026-12-05 and the company has only fiscal year 2026
- **THEN** the read reports 26 days remaining, next year missing, zero next-year budgets, and
  `ready = false`

#### Scenario: Fully prepared

- **WHEN** fiscal year 2027 exists `OPEN`, holds `ACTIVE` budgets, and every (`quota_id`, `employee_id`)
  pair with a 2026 `quota_entitlement` also has a 2027 one
- **THEN** the read reports `ready = true`, whether or not a 2027 `BUDGET_RATE` exists

#### Scenario: A plan that is only proposed does not count

- **WHEN** fiscal year 2027 exists but its budget plan is still in approval, so its budgets are not
  `ACTIVE`
- **THEN** the next-year budget count is zero and `ready = false`

#### Scenario: Unauthorized caller

- **WHEN** a user holding none of `FISCAL_YEAR_MANAGE`, `BUDGET_MANAGE`, `QUOTA_MANAGE` requests
  readiness
- **THEN** the request is refused with 403

### Requirement: Admins Are Warned Thirty Days Before Year End

The system SHALL warn admins from 30 days before the current fiscal year's `end_date`
(company-local) until the next year is ready: it SHALL notify every active user of the company who holds `FISCAL_YEAR_MANAGE`,
`BUDGET_MANAGE` or `QUOTA_MANAGE` at most once per company-local day. The notice SHALL name what
is still missing (fiscal year, active budgets, quota entitlements) and link to the readiness view.
Notification SHALL stop the day the read reports `ready = true`. If the year turns unprepared —
no `OPEN` fiscal year holding an `ACTIVE` budget covers today — the sweep SHALL keep sending the
notice daily, now stating that budget documents are blocked, until such a year exists.

#### Scenario: Warning starts thirty days out

- **WHEN** the daily sweep runs on 2026-12-01 (company-local), 2026's `end_date` is 2026-12-31,
  and 2027 is not ready
- **THEN** each holder of the three permission codes in that company receives one readiness notice

#### Scenario: Not yet in the window

- **WHEN** the sweep runs on 2026-11-30
- **THEN** no readiness notice is sent

#### Scenario: Once a day, not once an hour

- **WHEN** the sweep runs several times on the same company-local day
- **THEN** each recipient receives at most one readiness notice for that day

#### Scenario: Readiness ends the warnings

- **WHEN** an admin activates the 2027 plan and creates the missing entitlements so `ready = true`
- **THEN** the next sweep sends no readiness notice

#### Scenario: The year turned unprepared

- **WHEN** the sweep runs on 2027-01-02 and no open 2027 fiscal year with an active budget exists
- **THEN** each holder receives a notice stating that budget documents are currently blocked

#### Scenario: Users without the codes are not warned

- **WHEN** the sweep sends readiness notices
- **THEN** a user holding only `DOC_CREATE` receives none
