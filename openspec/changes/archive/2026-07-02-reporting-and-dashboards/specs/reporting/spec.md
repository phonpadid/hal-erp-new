## ADDED Requirements

### Requirement: Permission-Gated Reports

Each report SHALL be a permission-gated endpoint. Company-scoped reports SHALL require
`REPORT_VIEW`; the consolidated cross-company report SHALL require `REPORT_GROUP_VIEW` held at
GROUP scope. Reports over sensitive data (e.g. salary) SHALL additionally require
`EMP_SALARY_VIEW`. A caller lacking the required code SHALL be refused by the server; the client
navigation reflects the same codes as UX only.

#### Scenario: Caller without REPORT_VIEW is refused

- **WHEN** a user without `REPORT_VIEW` requests a company report endpoint
- **THEN** the request is refused by the server

#### Scenario: Group report requires GROUP scope

- **WHEN** a user holding `REPORT_GROUP_VIEW` only at COMPANY scope requests the cross-company report
- **THEN** the request is refused

### Requirement: Read-Only Aggregation

Reports SHALL be computed by aggregation over existing tables and MUST NOT insert, update, or
delete any row. Running a report MUST NOT create `budget_txn`, `quota_usage`, or `approval_log`
rows.

#### Scenario: Running a report writes nothing

- **WHEN** any report is executed
- **THEN** no row in any table is inserted, updated, or deleted

### Requirement: Company Isolation

Every report query SHALL filter by the active `company_id` first. Only the consolidated report
(GROUP scope) MAY span more than one company, and its results SHALL be read-only and limited to
companies the user belongs to.

#### Scenario: Company-scope caller never sees another company

- **WHEN** a company report runs
- **THEN** every returned row belongs to the active company only

#### Scenario: Group scope aggregates across member companies read-only

- **WHEN** a GROUP-scope user runs the consolidated report
- **THEN** results cover only the companies the user belongs to and no write occurs

### Requirement: Derived Budget Figures

Budget reports SHALL derive balance and utilization by summing `budget_txn`
(`amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN − TRANSFER_OUT − RESERVE
− ACTUAL + RELEASE`) and MUST NOT read a stored usage value or treat `budget.amount_total`
as anything other than the opening amount.

#### Scenario: Utilization is computed from the ledger

- **GIVEN** a department budget with `amount_total` 1,000,000 and `budget_txn` summing to 250,000 RESERVE and 0 ACTUAL
- **WHEN** the budget-utilization report runs
- **THEN** consumed is reported as 250,000 (reserved + actual) and utilization as 25%, derived from `budget_txn`

### Requirement: Base-Currency Aggregation

Reports that sum amounts across documents SHALL use the locked base-currency columns
(`document.base_total_amount`) and MUST NOT recompute the exchange rate.

#### Scenario: Spend sums use locked base amounts

- **WHEN** the spend-by-vendor report aggregates documents in mixed currencies
- **THEN** amounts are summed using `base_total_amount` without recomputing FX

### Requirement: Money as String

Report responses SHALL carry monetary values as decimal strings (never a JS number) so the
client can format by `currency.decimal_places`.

#### Scenario: Monetary fields are strings

- **WHEN** any report returns monetary values
- **THEN** each monetary field is a decimal string

### Requirement: Report Filters

The system SHALL validate report parameters (fiscal year, department, document type, date range)
with a DTO and SHALL reject malformed parameters. Unsupplied optional filters SHALL default to the
report's documented default.

#### Scenario: Invalid filter is rejected

- **WHEN** a report is run with a malformed date
- **THEN** the request is rejected with a validation error and no query executes

### Requirement: Document Reporting

The system SHALL provide a document-summary report over `document` giving volume (count) and
summed locked base amount grouped by document type and status, plus per-status totals; and a
spend-by-vendor report summing `base_total_amount` over committed documents (APPROVED or
COMPLETED) grouped by vendor, ordered high→low with a running cumulative share.

#### Scenario: Document volume grouped by type and status

- **WHEN** the document-summary report runs
- **THEN** each (document type, status) cell reports a count and summed base amount, and per-status totals are returned

#### Scenario: Spend by vendor is ranked with cumulative share

- **WHEN** the spend-by-vendor report runs
- **THEN** vendors are ordered by descending base spend and each carries a running cumulative percentage reaching 100

### Requirement: Report Export

The system SHALL allow exporting a report the caller may run as CSV, applying the same permission
code, scope, and filters as the on-screen report, with monetary values kept as strings.

#### Scenario: Export honors permission and filters

- **WHEN** a `REPORT_VIEW` user exports a report with a filter applied
- **THEN** the CSV contains exactly the permitted, filtered rows and money is emitted as decimal strings
