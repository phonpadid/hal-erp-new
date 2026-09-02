# gl-journal

## ADDED Requirements

### Requirement: Open Payables Are Aged Against The Company's Day

Each open payable SHALL carry the number of days it is overdue and the ageing bucket it falls in —
not yet due, 1–30, 31–60, 61–90, or over 90 — measured from its due date.

The day the ageing is measured against SHALL be the company's calendar day, resolved on the server
from the company's timezone, and SHALL be resolved once per read so that a request spanning midnight
cannot place two payables of the same due date in different buckets.

The bucket SHALL NOT be computed by the client: a due date is a company-day, the viewer's browser
day is not, and a client-side bucket would classify the same payable differently for viewers in
different timezones.

Ageing SHALL be measured from the DUE date rather than the invoice date. A payable on sixty-day
terms is not late on the day it is raised.

#### Scenario: A payable past its due date is aged

- **GIVEN** an open payable whose due date was forty days ago in the company's timezone
- **WHEN** the read runs
- **THEN** it reports forty days overdue and the 31–60 bucket

#### Scenario: A payable not yet due is not aged into a band

- **GIVEN** an open payable whose due date is in the future
- **WHEN** the read runs
- **THEN** it reports the not-yet-due bucket and no positive days overdue

#### Scenario: Two companies in different zones age the same due date on their own day

- **GIVEN** the same due date for payables of two companies whose timezones differ across midnight
- **WHEN** each company's read runs
- **THEN** each is aged against its own company day

### Requirement: The Ageing Summary Is Read From The Server

The system SHALL expose the ageing totals — the amount and count in each bucket — as a
company-scoped read gated by `GL_VIEW`, derived from the same open payables and the same company day
as the list, so the summary and the rows cannot disagree.

Amounts SHALL be summed as decimal strings, never through a JS number.

#### Scenario: The buckets total what the rows hold

- **GIVEN** open payables spread across several buckets
- **WHEN** the ageing summary is read
- **THEN** each bucket reports the total and count of the payables in it, and their sum equals the
  total of all open payables

#### Scenario: The summary is company-scoped

- **WHEN** a user in company A reads the ageing
- **THEN** no payable of another company contributes to any bucket
