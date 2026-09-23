## ADDED Requirements

### Requirement: Pending Summary Tab With Weekly Filters And Export

The approvals page SHALL offer, beside the inbox, a **pending summary** tab (route
`/approvals/summary`) available to any `DOC_VIEW` user, showing the documents still in approval
that the reader may see (`GET /approvals/pending-summary`) with roll-up cards (by department, by
step, by approver, and totals per currency) above a detail table (document number linking to the
document, type, requester, department, submitted date, days waiting, current step, waiting on,
amount in its own currency, SLA state).

The tab SHALL provide a filter bar with a department select and a document-type select whose
options come from the response's `facets` (not from a permission-gated master list), a
submitted-date range with **this week** / **last week** / **all** presets (weeks run Monday to
Sunday in the company's timezone), and an overdue-only toggle. Changing a filter SHALL re-request
the summary with the corresponding query parameters. The filter bar SHALL show active-filter chips
that can be removed individually.

An **Export to Excel** button SHALL download `GET /approvals/pending-summary.xlsx` with the filter
bar's current values, be disabled with a loading state while in flight, and report a failure
through the toast layer. Money SHALL be formatted using the row's currency `decimal_places` and
never handled as a JS number. Labels SHALL be rendered through i18n in `en`, `la` and `zh`.

#### Scenario: Last week's submissions for one department

- **GIVEN** the reader picks department A and the "last week" preset
- **WHEN** the summary loads
- **THEN** the app requests `pending-summary` with `departmentId` = A, `submittedFrom` = last
  Monday and `submittedTo` = last Sunday, and the cards and table show that set

#### Scenario: Export carries the filters on screen

- **WHEN** the reader clicks Export to Excel with those filters applied
- **THEN** the app requests `pending-summary.xlsx` with the same query parameters and saves the
  response as an `.xlsx`

#### Scenario: A reader without DOC_VIEW is not offered the tab

- **WHEN** a user holding `DOC_APPROVE` but not `DOC_VIEW` opens the approvals page
- **THEN** the summary tab is not shown

#### Scenario: The department options are the ones present

- **GIVEN** the reader's pending set spans departments A and B only
- **WHEN** the filter bar renders
- **THEN** the department select offers A and B with their counts, and nothing else
