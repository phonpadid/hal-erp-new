## ADDED Requirements

### Requirement: Document Submit Lifecycle

On submit the system SHALL, in a single transaction: validate that every required
`form_field` has a value; resolve and **lock** the FX rate at the submit date, stamping
`exchange_rate`, `base_total_amount`, and each line's `base_line_amount`; reject the
submit if the document's date falls in a CLOSED fiscal period; reject any vendor or item
not enabled for the active company; and then transition the document from `DRAFT` to
`SUBMITTED`. If any step fails, no holds are created and the document stays `DRAFT`.

#### Scenario: Submit locks the FX rate and base amounts

- **WHEN** a foreign-currency document is submitted
- **THEN** `exchange_rate` and `base_total_amount` are stamped from the rate resolved at
  the submit date, and a later rate change does not alter them

#### Scenario: Missing required field blocks submit

- **GIVEN** a required `form_field` with no `doc_field_value`
- **WHEN** the document is submitted
- **THEN** submission is rejected and the document remains `DRAFT`

#### Scenario: Submit into a closed period is rejected

- **WHEN** a budget-consuming document dated in a CLOSED fiscal year is submitted
- **THEN** submission is rejected with a closed-period error

### Requirement: Configuration-Driven Holds

Whether submit creates budget and quota holds SHALL be driven by the `document_type`
flags `requires_budget` and `requires_quota` — not by hardcoded per-type logic
(invariant 7). When `requires_budget` is true, submit SHALL reserve budget per line
grouped by `budget_id`; when `requires_quota` is true, submit SHALL reserve quota. On
cancel or reject the system SHALL release all of the document's budget and quota holds.

#### Scenario: Non-budget, non-quota type creates no holds

- **GIVEN** a document type with `requires_budget = false` and `requires_quota = false`
- **WHEN** a document of that type is submitted
- **THEN** no `budget_txn` and no `quota_usage` rows are created

#### Scenario: Budget type reserves per line

- **GIVEN** a `requires_budget` document with two lines on two different budgets
- **WHEN** it is submitted
- **THEN** one RESERVE is recorded against each budget for that line's base amount

#### Scenario: Cancel releases all holds

- **GIVEN** a submitted document holding budget (and/or quota) reservations
- **WHEN** it is cancelled
- **THEN** every reservation is released (budget RELEASE and quota RELEASE rows)

### Requirement: Authorized, Company-Scoped Document Operations

Configuration endpoints SHALL require `DOC_CONFIG_MANAGE`; runtime operations SHALL
require `DOC_VIEW` / `DOC_CREATE` / `DOC_SUBMIT` / `DOC_CANCEL` as appropriate, always by
permission code. Documents SHALL be company-scoped — reads return only the active
company's documents, and a document is created in the active company with its number
issued from that company's counter. UUID path parameters SHALL be validated.

#### Scenario: Document numbering is per company, type, and year

- **WHEN** two documents of the same type are created concurrently in one company-year
- **THEN** both receive unique, sequential `doc_no` values with no collision

#### Scenario: Submitting without permission is forbidden

- **WHEN** a request without `DOC_SUBMIT` calls the submit endpoint
- **THEN** it is rejected with 403 before the handler runs
