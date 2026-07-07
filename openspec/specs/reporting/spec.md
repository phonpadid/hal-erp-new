# reporting Specification

## Purpose
TBD - created by archiving change company-operational-reports. Update Purpose after archive.
## Requirements
### Requirement: Report Access Control

The system SHALL expose operational reports only to callers holding `REPORT_VIEW`, and every report
query SHALL be scoped to the active company exactly as the underlying resources are. Reports SHALL be
strictly read-only: they MUST NOT write to any ledger (`budget_txn`, `approval_log`, `quota_usage`)
or any other table. All monetary values SHALL be returned as decimal strings in the company base
currency and formatted using the currency's `decimal_places` (never a JS number).

#### Scenario: Report requires REPORT_VIEW

- **WHEN** a caller without `REPORT_VIEW` requests any report endpoint
- **THEN** the request is rejected by the permission guard

#### Scenario: Reports are company-scoped

- **WHEN** a user with `REPORT_VIEW` runs a report
- **THEN** only the active company's data is included, and no other company's rows appear

#### Scenario: Reports never mutate ledgers

- **WHEN** any report is generated
- **THEN** no row is inserted, updated, or deleted in `budget_txn`, `approval_log`, or `quota_usage`

### Requirement: Real-Time Budget Balance Report by Department and Category

The system SHALL provide a budget-balance report for the active company that, for each budget,
derives the balance from `budget_txn` as amount_total + ADJUST_INCREASE − ADJUST_DECREASE +
TRANSFER_IN − TRANSFER_OUT − RESERVE − ACTUAL + RELEASE in the company base currency, and SHALL
present rows grouped by department and by category (GL account) with their component subtotals
(amount_total, adjustments, transfers, reserved, actual, released, available). The report SHALL
support filtering by fiscal year and department. Balances SHALL be computed fresh on each request and
MUST NOT be read from a stored balance column.

#### Scenario: Balance grouped by department and category

- **WHEN** a user runs the budget-balance report for the active company
- **THEN** each row shows a department + category with its derived available balance and component
  subtotals, summed from that group's budgets

#### Scenario: Balance reflects the ledger live

- **WHEN** a new RESERVE (or ACTUAL/RELEASE) row is appended to `budget_txn` and the report is re-run
- **THEN** the affected group's available balance reflects the change without any stored value being
  overwritten

#### Scenario: Filter by department

- **WHEN** the user filters the report by a department
- **THEN** only that department's budgets are aggregated

### Requirement: Pending-Approval Aging and Bottleneck Report

The system SHALL provide a report of all documents currently `IN_APPROVAL` in the active company —
not limited to documents the caller may act on — showing for each the current step, the eligible
approver(s) the step is waiting on, the document age (since submit), the time-in-step (since the most
recent action at or below the current step, falling back to the submit time), and the SLA due time
and overdue flag (computed with the working-time calendar). The report SHALL also provide roll-ups
that group the pending documents by approver and by step so approval bottlenecks are visible.

#### Scenario: Pending document shows step, approver, and aging

- **WHEN** a user runs the approval-aging report
- **THEN** each pending document shows its current step, the resolved eligible approver(s), its
  document age, its time-in-step, and its SLA/overdue status

#### Scenario: Report is not limited to the caller's actionable items

- **WHEN** a document is pending on an approver other than the caller
- **THEN** it still appears in the report (the report shows the true waiting set, not the caller's
  inbox)

#### Scenario: Bottlenecks roll up by approver and by step

- **WHEN** the user views the report's roll-ups
- **THEN** pending counts (and oldest age) are grouped by approver and by step, surfacing where
  approvals are stuck

#### Scenario: Overdue respects the working-time calendar

- **WHEN** a step's SLA elapses across a weekend or company holiday
- **THEN** the overdue flag is computed using the working-time calendar, not raw elapsed hours

### Requirement: Per-Person Quota Remaining Report

The system SHALL provide a report listing, for the active company's quotas and a chosen year/period,
each employee's entitlement, used, and remaining quota (e.g. leave days left), derived from
`quota_usage` (Σ USE − Σ RELEASE) against the per-employee entitlement. The period and year SHALL
default to the current cycle and MAY be overridden by the caller.

#### Scenario: Remaining per employee

- **WHEN** a user runs the quota-remaining report
- **THEN** each row shows a quota, an employee, and that employee's entitled / used / remaining for
  the selected period

#### Scenario: Period selection

- **WHEN** the caller selects a year/period
- **THEN** usage and remaining are computed for that period using the quota's reset cycle

### Requirement: Budget Movement Audit Trail Report

The system SHALL provide a chronological audit report of `budget_txn` movements for the active
company, each row showing the transaction type, amount, timestamp, the originating document
(`doc_no`, linked when present), the remark, and the actor, ordered newest-first and filterable by
budget or department and by date range. Because the ledger is append-only, corrections SHALL appear
as their own rows; the report SHALL NOT hide or merge them.

#### Scenario: Movement rows carry their source document

- **WHEN** a user runs the budget-audit report
- **THEN** each movement row shows its txn type, amount, timestamp, and a link to the originating
  document when one exists

#### Scenario: Chronological and filterable

- **WHEN** the user filters by a budget or department and a date range
- **THEN** only matching movements are listed, ordered newest-first

#### Scenario: Corrections remain visible

- **WHEN** a correcting movement was appended to reverse an earlier one
- **THEN** both the original and the correcting rows appear in the audit trail

### Requirement: Consolidated Group Budget-Balance Report

The system SHALL provide a consolidated budget-balance report for Group executives that aggregates
EVERY active company's budget balances and converts them into a caller-chosen presentation currency.
Access SHALL require the `REPORT_GROUP_VIEW` permission held at GROUP scope: the endpoint SHALL
require the permission code, and the service SHALL verify it is granted at GROUP scope before reading
across companies; a caller holding only company-scoped `REPORT_VIEW` (or `REPORT_GROUP_VIEW` at a
narrower scope) SHALL be refused. The cross-company read SHALL be read-only.

For each active company, the report SHALL derive budget balances from `budget_txn` using the same
derived-balance formula as the company-scoped report (never a stored value), in that company's base
currency, then convert the company's totals into the presentation currency using the GROUP exchange
rate as of the report date (the company-override→GROUP→inverse resolution with no company override),
defaulting the date to today. The conversion SHALL be presentation-only: it MUST NOT write any ledger
row, MUST NOT modify `budget.amount_total`, and MUST NOT alter any document's locked exchange rate
(invariant: locked FX). The response SHALL include, per company, the source base currency, the
resolved rate and its source, the native-currency total, and the converted total; plus a group total
in the presentation currency.

When no exchange rate resolves for a company's base→presentation pair as of the date, that company
SHALL be reported as unconvertible with its native total still shown, and SHALL be excluded from the
group total rather than failing the entire report. A company whose base currency equals the
presentation currency SHALL convert at rate 1.

#### Scenario: Group total in the chosen presentation currency

- **WHEN** a caller with `REPORT_GROUP_VIEW` at GROUP scope requests the consolidated report for a
  presentation currency
- **THEN** every active company's budget balances are shown converted into that currency at the GROUP
  rate as of the report date, with a group total in that currency

#### Scenario: Requires GROUP-scope permission

- **WHEN** a caller holding only company-scoped `REPORT_VIEW` (or `REPORT_GROUP_VIEW` not at GROUP
  scope) requests the consolidated report
- **THEN** the request is refused and no cross-company data is read

#### Scenario: Conversion is presentation-only

- **WHEN** the consolidated report converts each company's totals
- **THEN** no `budget_txn` row is written, no `budget.amount_total` is changed, and no document's
  locked exchange rate is recomputed

#### Scenario: A company without a resolvable rate is reported, not fatal

- **WHEN** no GROUP rate resolves for one company's base→presentation pair as of the date
- **THEN** that company is marked unconvertible with its native total shown and is excluded from the
  group total, while the other companies still convert and the report still returns

#### Scenario: Same-currency company converts at parity

- **WHEN** a company's base currency equals the presentation currency
- **THEN** its totals are included at rate 1 (no rate lookup needed)

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
COMPLETED) grouped by vendor, ordered high→low with a running cumulative share. The
document-summary report SHALL group by the document's type identity and SHALL return its rows and
per-status totals even when a document's type cannot be fully resolved (e.g. the related type
record is missing), degrading that document's type code/name to a defined fallback rather than
failing the request.

#### Scenario: Document volume grouped by type and status

- **WHEN** the document-summary report runs
- **THEN** each (document type, status) cell reports a count and summed base amount, and per-status totals are returned

#### Scenario: Spend by vendor is ranked with cumulative share

- **WHEN** the spend-by-vendor report runs
- **THEN** vendors are ordered by descending base spend and each carries a running cumulative percentage reaching 100

#### Scenario: A document with an unresolved type does not fail the report

- **WHEN** the document-summary report runs and a document's type cannot be fully resolved
- **THEN** the report still returns its grouped rows and per-status totals without error, and that document is counted under its type identity with a defined fallback type code/name

### Requirement: Report Export

The system SHALL allow exporting a report the caller may run as CSV, applying the same permission
code, scope, and filters as the on-screen report, with monetary values kept as strings.

#### Scenario: Export honors permission and filters

- **WHEN** a `REPORT_VIEW` user exports a report with a filter applied
- **THEN** the CSV contains exactly the permitted, filtered rows and money is emitted as decimal strings

