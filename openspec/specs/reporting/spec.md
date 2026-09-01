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
TRANSFER_IN − TRANSFER_OUT − RESERVE + RELEASE in the company base currency, and SHALL present rows
grouped by department and by **budget node** with their component subtotals (amount_total,
adjustments, transfers, reserved, actual, released, available). A node's subtotal SHALL be the sum
over every budget beneath it in the `budget_node.parent_id` tree, so a category row states what that
category has spent and a department row what the department has. A node holds no figures of its own
to add — it is structure, not money — so nothing in the tree is counted twice.

Grouping by GL account is withdrawn. One account is charged by several budgets and one budget posts
to several accounts, so an account no longer names a group anyone can act on: the money under
`658.0007` belongs partly to fuel, partly to repairs and partly to registration, split by decisions
recorded per transaction. The question this report answers is about the budget node, which is the
question the organisation asks and the level at which its spending is actually controlled.

ACTUAL SHALL be reported as a component and SHALL NOT be subtracted from available — it draws down a
reservation that already reduced the balance (invariant 3). The report SHALL support filtering by
fiscal year and department. Balances SHALL be computed fresh on each request and MUST NOT be read
from a stored balance column.

#### Scenario: Balance grouped by department and budget node

- **WHEN** a user runs the budget-balance report for the active company
- **THEN** each row shows a department + budget node with its derived available balance and
  component subtotals, summed from the budgets beneath that node

#### Scenario: A category row totals its children

- **GIVEN** a category node with three budgets beneath it carrying reservations
- **WHEN** the report is run
- **THEN** the category row's reserved subtotal is the sum of its children's

#### Scenario: One account across several budgets is not collapsed

- **GIVEN** two budgets in one department that both record `gl_account` `658.0007`
- **WHEN** the report is run
- **THEN** the two appear as separate rows under their own nodes and are not merged into an
  account-level row

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
approver(s) the step is waiting on, the document age (since submit), the time-in-step, and the SLA
due time and overdue flag (computed with the working-time calendar). The report SHALL also provide
roll-ups that group the pending documents by approver and by step so approval bottlenecks are
visible.

The current step's name, SLA hours and time-in-step SHALL be read from the step recorded on the
document's route: time-in-step is that step's `started_at`, not the most recent approval-log row at
or below the current step. That derivation was an approximation built from the only evidence
available before a step had a start time, and it misreports the first step of a resubmission, whose
latest log row belongs to the attempt before it.

#### Scenario: Pending document shows step, approver, and aging

- **WHEN** a user runs the approval-aging report
- **THEN** each pending document shows its current step, the resolved eligible approver(s), its
  document age, its time-in-step, and its SLA/overdue status

#### Scenario: Time-in-step is the step's own elapsed time

- **GIVEN** a document whose second step opened two hours ago after a first step that took two days
- **WHEN** the report is run
- **THEN** its time-in-step is two hours

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
company, each row showing the transaction type, amount, the day the movement happened (`txn_date`),
when the row was recorded (`created_at`), the originating document (`doc_no`, linked when present),
the remark, and the actor. Because the ledger is append-only, corrections SHALL appear as their own
rows; the report SHALL NOT hide or merge them.

Ordering and the date-range filter SHALL both use `txn_date` — the day the movement happened —
with `created_at` as the tie-break for rows sharing a day. A person asking for "the first half of
May" means movements that took effect then, not rows a server inserted then; a transfer effective
on 1 May and approved on the 20th belongs in the first half of May. This matches what the general
ledger already does with `entry_date`.

Both times SHALL be shown rather than one chosen for the reader. They answer different questions —
when it happened, and when the system learned of it — and an audit report is precisely where the
gap between them is worth seeing.

#### Scenario: Movement rows carry their source document

- **WHEN** a user runs the budget-audit report
- **THEN** each movement row shows its txn type, amount, the day it happened, when it was recorded,
  and a link to the originating document when one exists

#### Scenario: Chronological and filterable

- **WHEN** the user filters by a budget or department and a date range
- **THEN** only movements whose `txn_date` falls in that range are listed, ordered newest-first by
  that same day

#### Scenario: A backdated movement is filed under the day it took effect

- **GIVEN** a transfer effective on 1 May and approved on 20 May
- **WHEN** the user filters the first half of May
- **THEN** the movement is listed, and its row shows both 1 May and the 20 May recording time

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

Budget reports SHALL derive balance and utilization by summing `budget_txn` and MUST NOT read a
stored usage value or treat `budget.amount_total` as anything other than the opening amount.

Available SHALL be derived as `amount_total + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
TRANSFER_OUT − RESERVE + RELEASE`. ACTUAL SHALL NOT be subtracted (invariant 3).

Consumed SHALL be derived as `Σ RESERVE − Σ RELEASE` — every amount a document took from the budget
and did not give back, which is the outstanding reservations plus the settled spend. Consumed SHALL
NOT be derived as `Σ RESERVE + Σ ACTUAL`: ACTUAL draws down a reservation already counted in Σ
RESERVE, so adding it counts every settled document twice. Consumed SHALL NOT be derived as
`amount_total − available` either, because an `ADJUST_DECREASE` or `TRANSFER_OUT` removes money from
a budget without anyone consuming it. Utilization SHALL be `consumed / amount_total`.

#### Scenario: Utilization is computed from the ledger

- **GIVEN** a department budget with `amount_total` 1,000,000 and `budget_txn` summing to 250,000
  RESERVE and 0 ACTUAL
- **WHEN** the budget-utilization report runs
- **THEN** consumed is reported as 250,000 and utilization as 25%, derived from `budget_txn`

#### Scenario: A settled document is consumed once

- **GIVEN** a department budget with `amount_total` 1,000,000 whose ledger holds a RESERVE of
  100,000, an ACTUAL of 90,000 and a RELEASE of 10,000 for one completed document
- **WHEN** the budget-utilization report runs
- **THEN** consumed is 90,000 and utilization is 9% — not 190,000 and 19%

#### Scenario: Consumed and available reconcile on the same row

- **WHEN** the budget-utilization report runs for a department whose budgets carry no adjustment or
  transfer
- **THEN** consumed + available equals amount_total for that row

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

### Requirement: Budget-to-Ledger Reconciliation by Account and Fiscal Year

The system SHALL expose a read-only, company-scoped report that, for each account carrying a budget
in a chosen fiscal year, reports what the budget says and what the ledger says, and the difference
between them.

For each such account the report SHALL carry:

- **appropriated** — `Σ amount_total + Σ ADJUST_INCREASE − Σ ADJUST_DECREASE + Σ TRANSFER_IN −
  Σ TRANSFER_OUT` over that account's budgets for the year;
- **committed** — `Σ RESERVE − Σ RELEASE − Σ ACTUAL`, the outstanding reservation;
- **consumed** — `Σ ACTUAL`;
- **moved** — `Σ debit − Σ credit` on that account over the journal lines whose entry falls in the
  fiscal year's date range;
- **difference** — `moved − consumed`.

`moved` SHALL be taken in the direction the account naturally moves rather than as an absolute, so
that an expense account reduced by a reversal reports a reduction. The fiscal year SHALL be resolved
from the entry's `entry_date`, which is already the posting company's own calendar day, and never
from a timestamp.

The report SHALL be derived on read. It SHALL NOT store a reconciled figure, write any `budget_txn`,
write any `journal_entry`, or alter any document — a stored reconciliation is a third opinion about
facts two ledgers already hold.

It SHALL be gated by the reporting permission and scoped to the active company (invariant 1).

#### Scenario: An account with budget and ledger movement is reconciled

- **GIVEN** an account with an active budget for a fiscal year and journal lines dated inside it
- **WHEN** the reconciliation is read for that year
- **THEN** the row reports the appropriated, committed and consumed figures from the budget, the
  movement from the ledger, and the difference between consumed and moved

#### Scenario: A reversal reduces the ledger movement

- **GIVEN** an expense account debited 1,000 and later credited 1,000 by a reversal in the same year
- **WHEN** the reconciliation is read
- **THEN** the movement reported for that account is zero, not 2,000

#### Scenario: Movement outside the fiscal year is excluded

- **GIVEN** journal lines on a budgeted account dated after the fiscal year ends
- **WHEN** the reconciliation is read for that year
- **THEN** those lines are not counted in the movement

#### Scenario: Another company's budgets and entries are absent

- **WHEN** the reconciliation is read
- **THEN** no budget and no journal line of another company contributes to any figure

#### Scenario: The report writes nothing

- **WHEN** the reconciliation is read twice
- **THEN** no `budget_txn`, no `journal_entry` and no `gl_posting_attempt` row has been created or
  changed

### Requirement: The Difference Is Decomposed Until Nothing Is Unexplained

The report SHALL decompose each account's difference into named causes and SHALL report what remains
after them as **unexplained**. A single difference figure states that two books disagree without
giving anyone a way to act, and the decomposition is what makes the report answerable.

The causes SHALL be:

- **ledger movement from sources that consumed no budget**, grouped by the entry's `source_type` —
  a journal entry whose source has no `ACTUAL` row;
- **budget consumption posted to another account** — the share of a budget's `ACTUAL` that debited
  an account other than the budget's own, because the lines charging it named one. A budget may post
  to several accounts, so the account a budget belongs to and the accounts its spending reaches are
  no longer the same thing, and the report SHALL name that gap rather than leave it in the
  remainder. It SHALL be reported as two signed figures — what this account's budgets spent
  elsewhere, and what other accounts' budgets spent here — because a budget sending its spending out
  and an account receiving spending in are different facts that net to nothing when added;
- **budget consumption capitalised into stock** — the share of a document's `ACTUAL` the posting
  engine diverted to the goods-received account instead of the budgeted expense account, taken as
  the difference between that document's `ACTUAL` on the account and the debits its entries put
  there, rather than re-derived from the stock lines;
- **budget consumption whose posting never arrived** — `ACTUAL` rows for a document with no journal
  entry at all;
- **budget consumption dated outside the year of the appropriation it drew on** — `ACTUAL` rows on
  this year's budgets whose `txn_date` falls outside the fiscal year's date range. This is the
  cutoff: money charged to one year's appropriation on a day the ledger posted into another year.
  It SHALL be reported as two signed figures — consumption dated before the year and consumption
  dated after it — because a late arrival and an early one are different facts about a cutoff and
  net to nothing when added. Each SHALL carry the documents behind it (document number, the day the
  consumption was dated, and the amount), capped and counted, because the question the figure
  provokes is which ones.

Where a budget's `ACTUAL` reached more than one account, the share belonging to each SHALL be
derived the way the posting derived it: apportioned across the lines charging that budget pro rata
by `budget_base_line_amount`, keyed by each line's stamped account and falling back to the budget's
own where a line carries none. Both sides read values fixed at submit and immutable after it, so the
report and the ledger cannot disagree about where the money went. The report SHALL NOT re-derive the
account from the item or the document type, which are configuration and may have changed since.

The other-account share SHALL be attributed BEFORE the capitalisation cause and SHALL be subtracted
from what it sees. Capitalisation is inferred from a document's `ACTUAL` on an account exceeding
what its entries debited there, and that inference was sound only while one budget meant one
account: spending that went to another expense account satisfies it exactly as a diversion to the
goods-received account does. Without the subtraction the report names ordinary expense as
capitalised into stock — a false statement about inventory, in the figure an accountant would use to
explain the difference.

The crossing SHALL be attributed BEFORE the per-document causes and SHALL be subtracted from
what they see. Its amount SHALL NOT also be reported as a posting that never arrived or as
consumption capitalised into stock: a document posted in another year did post, so calling its
consumption a posting that never arrived is false, and counting the same money under two causes
makes the remainder non-zero in a report whose purpose is that it reaches zero. The subtraction
SHALL be by amount rather than by document, so a document settled partly inside the year and partly
outside it contributes to each cause only what belongs to it.

The budget side of the comparison SHALL continue to be grouped by the budget's own fiscal year, and
SHALL NOT be re-bounded by `txn_date`. An appropriation belongs to the year it was voted for, and a
row that consumes it belongs to that appropriation whatever day it fell on. Bounding the budget side
by date instead would drop a crossing row from both years' reports — out of this year by the bound,
out of the next because that report reads the next year's budgets — and the reconciliation would
balance by losing the evidence.

The budget side SHALL also continue to be grouped by the budget's own account. `appropriated` and
`committed` are facts about a budget, not about where its spending landed, and moving `consumed`
alone to the accounts it reached would report a ceiling on one row and the spending against it on
others. The account a budget names stays the row its figures are read on; where the spending went is
a cause, not a regrouping.

The unexplained remainder SHALL be reported per account. A non-zero unexplained figure means a cause
this report does not model, and SHALL be presented as something to investigate rather than as a
rounding.

#### Scenario: A budget posting to two accounts is explained on both rows

- **GIVEN** a budget on account `5200` charged 1000, whose lines stamped 400 to `5200` and 600 to
  `5210`, and a budget of its own on `5210` that consumed nothing
- **WHEN** the reconciliation is read
- **THEN** `5200` reports 600 as spent on another account and `5210` reports 600 as received from
  another account, and the unexplained remainder is zero on both

#### Scenario: Spending sent elsewhere is not called capitalisation

- **GIVEN** the same budget, whose document touches no stock-tracked line at all
- **WHEN** the reconciliation is read
- **THEN** the capitalisation figure on `5200` is zero, and the 600 appears only under the
  other-account cause

#### Scenario: A stock purchase on a line-stamped account is still capitalisation

- **GIVEN** a document whose stock-tracked line is stamped with an account of its own and was
  debited to the goods-received account
- **WHEN** the reconciliation is read
- **THEN** the amount appears under the capitalisation cause on the line's account, and the
  unexplained remainder is zero

#### Scenario: A document with both causes splits between them

- **GIVEN** a budget on `5200` whose lines sent 600 to `5210` and whose remaining stock-tracked
  share was diverted to the goods-received account
- **WHEN** the reconciliation is read
- **THEN** the 600 appears under the other-account cause, the diverted share under capitalisation,
  and the unexplained remainder is zero

#### Scenario: A budget whose lines carry no stamped account is unchanged

- **GIVEN** a budget charged by a document submitted before lines carried an account
- **WHEN** the reconciliation is read
- **THEN** its consumption is read on the budget's own account, the other-account figures are zero,
  and the report reads exactly as it did before this change

#### Scenario: Spending reaching an account no budget names is still explained

- **GIVEN** a budget on `5200` whose lines stamped 600 to `5400`, an account carrying no budget
- **WHEN** the reconciliation is read
- **THEN** `5200` reports 600 as spent on another account and its unexplained remainder is zero,
  and `5400` is reported so the movement is not invisible

#### Scenario: A manual voucher on a budgeted account is explained

- **GIVEN** a posted journal voucher debiting an account that carries a budget
- **WHEN** the reconciliation is read
- **THEN** its amount appears under the `MANUAL_JV` cause and the unexplained remainder is unchanged

#### Scenario: A stock purchase is explained by its capitalisation

- **GIVEN** a document whose stock-tracked lines were charged to a budget and debited to the
  goods-received account
- **WHEN** the reconciliation is read
- **THEN** the amount appears under the capitalisation cause and the unexplained remainder is zero

#### Scenario: A reversal that did not return the budget is visible

- **GIVEN** a settled document whose posting was later reversed, with no budget adjustment raised
- **WHEN** the reconciliation is read
- **THEN** the reversal appears under the `REVERSAL` cause, and the budget still reports the amount
  as consumed

#### Scenario: A December document approved in January is explained, not unexplained

- **GIVEN** a document that reserved a 2026 budget in December and was settled in January, so its
  `ACTUAL` is dated in 2027 while the appropriation is 2026's
- **WHEN** the 2026 reconciliation is read
- **THEN** the amount appears under the outside-the-year cause with that document named, and the
  unexplained remainder is zero

#### Scenario: Early and late crossings are reported separately

- **GIVEN** an account with one crossing dated before the year and one dated after it, of equal
  amount
- **WHEN** the reconciliation is read
- **THEN** both are reported, each with its own figure, rather than netting to nothing

#### Scenario: A crossing is not also counted as a posting that never arrived

- **GIVEN** a document whose only consumption is dated after the year and which therefore has no
  journal entry inside it
- **WHEN** the reconciliation is read
- **THEN** the amount appears under the outside-the-year cause only, the posting-never-arrived
  figure is zero for it, and the unexplained remainder is zero

#### Scenario: A document settled across the boundary splits between the causes

- **GIVEN** a document that consumed 100 inside the year and 40 after it, with a posting for the
  100 and none for the 40
- **WHEN** the reconciliation is read
- **THEN** 40 appears under the outside-the-year cause and the in-year 100 is explained on its own
  terms

#### Scenario: A crossing row is not dropped from both years

- **GIVEN** consumption on a 2026 budget dated in 2027
- **WHEN** the 2026 reconciliation is read
- **THEN** the row is still counted in 2026's `consumed`, and is explained rather than removed

#### Scenario: Everything explained leaves nothing unexplained

- **GIVEN** an account whose only activity is budget-derived postings
- **WHEN** the reconciliation is read
- **THEN** its unexplained remainder is zero

### Requirement: Vouchers Reaching Budgeted Accounts Are Reported On Their Own

The report SHALL report, as a figure of its own, the total that journal vouchers moved on accounts
carrying a budget, and SHALL list the vouchers behind it.

This is separated from the other causes because it measures something no control observes: a voucher
writes no `budget_txn`, so expense can reach a budgeted account without any availability check being
consulted. The figure states how much has taken that path.

The report SHALL NOT treat the figure as an error. A company that budgets for depreciation would
expect its monthly voucher to appear here; one that does not would expect the opposite. Which of
those is intended is a policy this report does not hold.

#### Scenario: The total and its vouchers are readable

- **GIVEN** two posted vouchers touching budgeted accounts and one touching only unbudgeted accounts
- **WHEN** the reconciliation is read
- **THEN** the figure covers the first two, and lists them, and excludes the third

#### Scenario: No such voucher reports zero rather than nothing

- **GIVEN** a company whose vouchers touch only unbudgeted accounts
- **WHEN** the reconciliation is read
- **THEN** the figure is zero and is still reported

