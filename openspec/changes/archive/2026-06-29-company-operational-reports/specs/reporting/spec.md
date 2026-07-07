## ADDED Requirements

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
