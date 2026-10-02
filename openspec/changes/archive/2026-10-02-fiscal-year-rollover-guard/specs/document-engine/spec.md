## ADDED Requirements

### Requirement: A Budget Document Is Created Only Inside a Budgeted Open Year

Creating a document whose `document_type.requires_budget` is true SHALL be refused, before any
document number is issued, unless the active company has a `fiscal_year` with `status = 'OPEN'`
whose `start_date`..`end_date` covers today in `company.timezone`, and that fiscal year holds at
least one `budget` with `status = 'ACTIVE'`. The refusal SHALL be an explained error whose key
distinguishes "no open fiscal year covers today" from "the fiscal year has no active budget", and
SHALL name the year. Document types with `requires_budget = false` SHALL be created exactly as
before. A successor created from an approved predecessor (create-from, whether a user asks for it or the
`CREATE_SUCCESSOR` post-action does) SHALL be exempt, because the budget it charges is already reserved by the
predecessor. The guard branches only on `requires_budget`, never on a type code (invariant 7).

#### Scenario: New year without a fiscal year

- **WHEN** a requester creates a `requires_budget` document on 2027-01-02 and the company has no
  fiscal year covering 2027-01-02
- **THEN** creation is refused with the "no open fiscal year" error naming 2027, and no
  `doc_running_number` counter advances

#### Scenario: Fiscal year exists but holds no active budget

- **WHEN** fiscal year 2027 exists `OPEN` but none of its budgets is `ACTIVE`
- **THEN** creating a `requires_budget` document is refused with the "no active budget" error

#### Scenario: Non-budget documents carry on

- **WHEN** the same company has no 2027 fiscal year and a user creates a leave request whose type
  has `requires_budget = false`
- **THEN** the document is created normally

#### Scenario: Budget plans can always be raised

- **WHEN** no 2027 budget is active and an admin creates a budget-plan document (its type has
  `requires_budget = false`)
- **THEN** the document is created, so the year can be budgeted at all

#### Scenario: A system-created successor is exempt

- **WHEN** a purchase request approved in December 2026 creates its purchase-order successor on
  2027-01-03 through `CREATE_SUCCESSOR`, and 2027 has no active budget
- **THEN** the successor is created and keeps the budget its predecessor reserved

### Requirement: Creatable Types Report a Year Block

The creatable-types read SHALL mark each `requires_budget` type as blocked when the creation guard
above would refuse it, and SHALL carry the same error key and year so the client can explain it
before the user fills a form. Types with `requires_budget = false` SHALL never be marked blocked.

#### Scenario: Blocked type is flagged

- **WHEN** a `DOC_CREATE` user lists creatable types on 2027-01-02 with no budgeted 2027 year
- **THEN** every `requires_budget` type carries `blocked` with the "no open fiscal year" key and
  year 2027, and every other type carries no block

### Requirement: Document Year Is the Company's Local Year

The system SHALL take the document year from today in `company.timezone`, not in UTC: that is the
year stamped into a document number and into `doc_running_number.year`, and the date against
which submit resolves the open fiscal year. The
same SHALL hold for budget adjustment, transfer and plan numbering.

#### Scenario: Early morning on New Year's Day

- **WHEN** a document is created at 2027-01-01 03:00 in a company whose timezone is
  `Asia/Vientiane` (2026-12-31 20:00 UTC)
- **THEN** its number carries 2027 and its counter is the 2027 row of `doc_running_number`
