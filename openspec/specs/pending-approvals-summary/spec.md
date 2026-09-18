# pending-approvals-summary Specification

## Purpose
The department's weekly question — what did we submit that is still waiting for approval, where
is it stuck, on whom, and for how long — answered for the documents the reader may see under their
`DOC_VIEW` scope, with week / department / type / overdue filters, roll-ups, and an Excel export
for the head. Not the inbox: the inbox is what the reader must sign.
## Requirements
### Requirement: The Pending Set A Reader May See

The system SHALL expose `GET /approvals/pending-summary`, gated by `DOC_VIEW`, returning every
document of the active company whose `status` is `IN_APPROVAL` that the caller may see under their
`DOC_VIEW` data scope — the same predicate the documents list applies (own / department / company,
widened by the documents the caller is party to) — regardless of whether the caller is an eligible
approver of its current step. The set SHALL NOT be limited to the caller's inbox: a department's
weekly question is what it submitted and is still waiting for, wherever that waits.

Each row SHALL carry: `documentId`, `docNo`, document type (`code`, `name`), `department`
(`id`, `deptCode`, `name`), requester (`employee.full_name` when the creating user is linked to an
employee, else `app_user.username`), `submittedAt`, `waitingDays` (whole days from `submitted_at`
to now), `currentStepNo`, `stepName`, `waitingOn` (the eligible approvers of the current step, by
the same resolver acting uses), `currencyCode` (the document's, else the company base),
`grandTotal` as a decimal string, `slaDueAt` and `overdue` (working-time calendar, as the aging
report computes them).

The endpoint SHALL be read-only and SHALL NOT write any table.

#### Scenario: A department-scope reader sees their department's documents wherever they wait

- **GIVEN** a reader whose `DOC_VIEW` grant is `DEPARTMENT` scope for department A, and an
  `IN_APPROVAL` document of A whose current step waits on a director in department B
- **WHEN** the reader requests the summary
- **THEN** the document is listed, with the director under `waitingOn`

#### Scenario: Another department's document is not shown to a department-scope reader

- **GIVEN** the same reader and an `IN_APPROVAL` document of department C the reader is not party to
- **WHEN** the reader requests the summary
- **THEN** that document is not listed

#### Scenario: A company-scope reader sees the whole company

- **WHEN** a reader whose `DOC_VIEW` grant is `COMPANY` scope requests the summary
- **THEN** every `IN_APPROVAL` document of the active company is listed, and none of another
  company's

#### Scenario: Only documents still in approval are listed

- **GIVEN** documents in `DRAFT`, `SUBMITTED`, `IN_APPROVAL`, `COMPLETED` and `REJECTED`
- **WHEN** the summary is requested
- **THEN** only the `IN_APPROVAL` document is listed

### Requirement: The Summary Is Filtered By Department, Type, Week And Overdue

The endpoint SHALL accept optional `departmentId`, `documentTypeId`, `submittedFrom`,
`submittedTo` (dates; `submittedTo` inclusive of its whole day in the company's timezone) and
`overdueOnly` (boolean). Filters SHALL combine conjunctively and SHALL only narrow the set the
reader may see — a `departmentId` outside the reader's scope or company SHALL match no rows rather
than widen visibility. Inputs SHALL be validated (UUID, date, boolean) before the handler runs.

The response SHALL also carry `facets`: the departments and document types present in the
reader's UNFILTERED pending set (`id`, code, name, count), so the client can offer filter options
without a separate permission-gated list.

#### Scenario: A week's submissions

- **GIVEN** documents submitted on Monday and on the following Monday, both still in approval
- **WHEN** the summary is requested with `submittedFrom` = that Monday and `submittedTo` = that Sunday
- **THEN** only the first is listed

#### Scenario: Department and overdue narrow together

- **GIVEN** an overdue document of department A, an on-time document of A, and an overdue document
  of B
- **WHEN** the summary is requested with `departmentId` = A and `overdueOnly` = true
- **THEN** only the first is listed

#### Scenario: Facets describe the unfiltered set

- **GIVEN** a reader who may see pending documents of departments A and B
- **WHEN** they request the summary with `departmentId` = A
- **THEN** `facets.departments` still lists both A and B with their counts

#### Scenario: A foreign department id matches nothing

- **WHEN** the summary is requested with a `departmentId` belonging to another company
- **THEN** no rows are returned and no error reveals whether it exists

### Requirement: Roll-Ups Over The Filtered Set

The response SHALL carry roll-ups computed over the filtered rows: `byDepartment` (department,
`pendingCount`, `oldestWaitingDays`, `totals` per currency), `byStep` (`stepNo`, `stepName`,
`pendingCount`, `oldestWaitingDays`), `byApprover` (`userId`, name, `pendingCount`,
`oldestWaitingDays` — a document counted once under each approver it waits on), and `totals`
(`pendingCount`, `overdueCount`, amounts per currency). Amounts SHALL be summed as decimal strings
per currency and SHALL NOT be added across currencies or converted.

#### Scenario: Totals per currency

- **GIVEN** filtered rows of 1,000,000 LAK, 500,000 LAK and 100 USD
- **WHEN** the summary is requested
- **THEN** `totals.amounts` is `{ LAK: '1500000', USD: '100' }` and `totals.pendingCount` is 3

#### Scenario: A document waiting on two approvers counts under both

- **GIVEN** a document whose current step is eligible to two approvers
- **WHEN** the summary is requested
- **THEN** `byApprover` counts it once under each, and `totals.pendingCount` counts it once

### Requirement: The Summary Exports As One Workbook

`GET /approvals/pending-summary.xlsx` SHALL accept the same filters, apply the same scope, and
return an `.xlsx` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, as an
attachment named `pending-approvals-<company code>-<yyyy-mm-dd>.xlsx`) with, in order: a title
(`ສະຫຼຸບເອກະສານຄ້າງອະນຸມັດ`), header lines (company, department filter or "ທຸກພະແນກ", period
or "ທັງໝົດທີ່ຍັງຄ້າງ", generated date), the three roll-ups with their counts and per-currency totals,
then a detail table headed in Lao: index, document number, type, requester, department, submitted
date, days waiting, current step, waiting on, one amount column per currency (`LAK`, `THB`, `USD`,
`CNY`, then others present), SLA state, and a blank remark column. Dates SHALL be numeric Excel
serials with a date format; amounts numeric cells formatted by `currency.decimal_places`, produced
from the decimal string at the last step. Rows SHALL be ordered by `waitingDays` descending — the
longest-waiting first — then `docNo`.

#### Scenario: The workbook matches the screen

- **WHEN** the export is requested with `departmentId` = A and a week range
- **THEN** its detail rows are exactly the rows the JSON endpoint returns for the same query, and
  its roll-ups match the JSON roll-ups

#### Scenario: Longest wait first

- **GIVEN** documents waiting 12, 3 and 20 days
- **WHEN** the export is produced
- **THEN** the detail rows are in the order 20, 12, 3

#### Scenario: Export writes nothing

- **WHEN** the export is requested
- **THEN** the row counts of `document`, `approval_log` and `budget_txn` are unchanged

