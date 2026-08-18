# gl-journal

## REMOVED Requirements

### Requirement: Recording A Settlement Clears The Payable Its Accrual Raised

**Reason**: it specified a second clearing path for documents owed to a person. The payment posting
already reads the payable off the accrual's own credit line, so it clears a claim payable without
being told to; the settlement posting was that same function with the account hard-coded and
withholding removed. Replaced by the clearing rule in *Record Payment and FX Gain/Loss*.

## MODIFIED Requirements

### Requirement: Open Payables Are Readable

The system SHALL expose a read-only, company-scoped list of open payables, gated by `GL_VIEW`: the
documents that were accrued at approval and have not been paid. Each SHALL carry the kind of payable
it is, who it is owed to, the amount credited to the payable, the invoice date (the accrual's
`entry_date`) and a due date. The read MUST NOT mutate any ledger.

Open payables SHALL be derived, not stored: an accrual entry credited a payable account and no
payment entry exists for the same source. A derived read cannot drift from the journal because it is
read from it.

The read SHALL cover EVERY payable the ledger raises. A payable raised against `CLAIM_PAYABLE` is
owed to a person rather than a vendor, which makes it no less owed — and it is now cleared by the
same payment entry a trade payable is. This read breaks down a balance-sheet figure, and one that
covered a single payable account could not break down the company's payables at all.

The kind SHALL be derived from the account the accrual credited, not from whether the document
carries a vendor. The accrual made that decision and wrote it into the ledger; re-deriving it from
the document would be a second opinion about a fact the entry records.

Each row SHALL name who is owed. For a trade payable that is the document's vendor. For a claim it
is the employee the document relates to, when it names one, and otherwise SHALL be absent rather
than substituted — the person who raised a claim is frequently not the person owed it, and naming
the wrong payee is worse than naming none. The document number SHALL be present in either case.

A payable account that is not mapped for the company SHALL contribute no rows rather than causing
the read to fail: no accrual can have credited an account that does not exist, and a report that
failed on a company with no claims would take the trade ageing down with it.

#### Scenario: An approved, unpaid purchase is listed

- **GIVEN** a document of a vendor type that accrued at approval and has not been paid
- **WHEN** the open-payables read runs for its company
- **THEN** it is listed as a trade payable with its vendor, the accrued amount, its invoice date, and
  a due date that many days later, where the days come from that vendor's `payment_term_days`

#### Scenario: An approved, unpaid claim is listed

- **GIVEN** a document with no vendor that accrued at approval to the claim payable and has not been
  paid
- **WHEN** the read runs
- **THEN** it is listed as a claim payable with the accrued amount and the document number

#### Scenario: A paid purchase drops off

- **WHEN** the payment for an accrued document posts
- **THEN** that document no longer appears on the read

#### Scenario: A paid claim drops off

- **WHEN** the payment for an accrued claim posts
- **THEN** that document no longer appears on the read

#### Scenario: The kinds are distinguishable

- **GIVEN** one open trade payable and one open claim payable
- **WHEN** the read runs
- **THEN** each row states which kind it is, so trade and other payables can be told apart

#### Scenario: A claim names the employee it relates to

- **GIVEN** an open claim payable whose document names a related employee
- **WHEN** the read runs
- **THEN** the row reports that person as who is owed

#### Scenario: A claim with no named person is not attributed to its author

- **GIVEN** an open claim payable whose document names no related employee
- **WHEN** the read runs
- **THEN** who is owed is absent, and the row is still identified by its document number

#### Scenario: A company that has never owed a claim still reads its payables

- **GIVEN** a company with open trade payables and no `CLAIM_PAYABLE` account mapped
- **WHEN** the read runs
- **THEN** the trade payables are returned and the read does not fail

#### Scenario: The read is company-scoped and permission-gated

- **WHEN** a `GL_VIEW` user in company A runs the read
- **THEN** only company A's open payables are returned, and a request without `GL_VIEW` is rejected
  with 403

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

A claim payable SHALL be due on the day its obligation was raised — the accrual's `entry_date`.
Payment terms are an arrangement with a supplier, and there is no supplier: a person whose
compensation was approved is owed it now. A claim SHALL NOT be given a default term, which would
report a credit agreement nobody made, and SHALL NOT be left without a due date, which would keep
the company's oldest debts permanently out of every band.

#### Scenario: A payable past its due date is aged

- **GIVEN** an open payable whose due date was forty days ago in the company's timezone
- **WHEN** the read runs
- **THEN** it reports forty days overdue and the 31–60 bucket

#### Scenario: A payable not yet due is not aged into a band

- **GIVEN** an open payable whose due date is in the future
- **WHEN** the read runs
- **THEN** it reports the not-yet-due bucket and no positive days overdue

#### Scenario: A claim ages from the day it was approved

- **GIVEN** an open claim payable whose accrual was dated forty days ago in the company's timezone
- **WHEN** the read runs
- **THEN** it reports forty days overdue, with no term added to its due date

#### Scenario: Two companies in different zones age the same due date on their own day

- **GIVEN** the same due date for payables of two companies whose timezones differ across midnight
- **WHEN** each company's read runs
- **THEN** each is aged against its own company day

### Requirement: The Ageing Summary Is Read From The Server

The system SHALL expose the ageing totals — the amount and count in each bucket — as a
company-scoped read gated by `GL_VIEW`, derived from the same open payables and the same company day
as the list, so the summary and the rows cannot disagree.

The totals SHALL cover every kind of payable, and the summary SHALL additionally report the total
per kind. A reported total answers what the company owes; its composition answers what of. Reporting
only the first leaves the reader unable to separate trade from other payables, and reporting only
the second leaves them adding two figures by hand.

Amounts SHALL be summed as decimal strings, never through a JS number.

#### Scenario: The buckets total what the rows hold

- **GIVEN** open payables spread across several buckets
- **WHEN** the ageing summary is read
- **THEN** each bucket reports the total and count of the payables in it, and their sum equals the
  total of all open payables

#### Scenario: Both kinds are counted in one total

- **GIVEN** an open trade payable and an open claim payable
- **WHEN** the ageing summary is read
- **THEN** the overall total covers both

#### Scenario: The composition is reported beside the total

- **GIVEN** open payables of both kinds
- **WHEN** the ageing summary is read
- **THEN** the total owed per kind is reported, and the two sum to the overall total

#### Scenario: The summary is company-scoped

- **WHEN** a user in company A reads the ageing
- **THEN** no payable of another company contributes to any bucket

### Requirement: Every Entry Is Written Through One Balanced Constructor

The system SHALL persist a `journal_entry` and its `journal_line` rows through a single
constructor, and no posting path SHALL build them any other way. The constructor SHALL reject an
entry whose `Σ debit` differs from its `Σ credit` by any amount before anything is persisted, and
SHALL resolve `entry_date` by the company-day rule (see `Entry Date Is The Posting Company's Own
Calendar Day`). This makes `Balanced Entry Invariant` a check rather than a property of how each
path happens to be written — balanced-by-construction is true until the next edit, and says nothing
about a path added later.

The constructor SHALL additionally refuse an entry whose resolved `entry_date` falls inside a
`CLOSED` accounting period of the posting company (see `accounting-period`'s `A Closed Period
Refuses New Entries, And A Refused Posting Is Not Lost`). Having one place where the day is resolved
is what makes "is that day open?" answerable once instead of in every posting path, and is why this
requirement exists in the shape it does. A date no declared period covers SHALL post normally.

#### Scenario: An unbalanced draft is refused before anything is written

- **WHEN** a posting path offers lines whose debits and credits differ
- **THEN** the constructor throws naming the source, and no `journal_entry` and no `journal_line`
  row exists for it

#### Scenario: A closed day is refused before anything is written

- **WHEN** a posting path offers an entry whose resolved day falls inside a `CLOSED` period
- **THEN** the constructor throws naming the period, no row is written, and the failure is recorded
  as an undelivered posting rather than being lost

#### Scenario: Every path is constructed the same way

- **WHEN** a payment settlement, an approval accrual or a stock movement posts
- **THEN** its entry was written through the one constructor, with its balance asserted, its
  `entry_date` resolved in the posting company's timezone, and that day checked against the
  company's accounting periods

### Requirement: Entry Date Is The Posting Company's Own Calendar Day

Every `journal_entry.entry_date` SHALL be the calendar day the posted event fell on **in the posting
company's own `company.timezone`**, and SHALL NOT be derived from the UTC day of that instant. This
SHALL hold for every posting path — payment settlement, approval accrual, stock movement, and any
path added later — because `entry_date` is the only field deciding which period a figure belongs to,
and `financial-reports` ranges the trial balance, account ledger, income statement and balance sheet
over it.

Which *instant* a path posts on is unchanged and remains that path's own business: the payment's
`paid_at`, the document's `approved_at`, the movement's `created_at`, each with their existing
fallbacks. Only the conversion from that instant to a calendar day is fixed here.

A company's timezone SHALL be read from `company.timezone`; the system SHALL NOT substitute UTC when
resolving a company's day.

#### Scenario: An early-morning payment is dated that day, not the day before

- **GIVEN** a company whose `timezone` is `Asia/Vientiane` (UTC+7)
- **WHEN** a payment settles at 06:30 on 1 August local time, which is 23:30 on 31 July UTC
- **THEN** the entry's `entry_date` is `2026-08-01`, so the payment falls in the August income
  statement and not the July one

#### Scenario: A late-evening approval west of UTC stays in its own month

- **GIVEN** a company whose `timezone` is west of UTC, such as `America/New_York`
- **WHEN** a document that accrues at approval is approved at 23:00 local on the last day of a
  month, which is past midnight UTC and therefore already the next month there
- **THEN** the accrual's `entry_date` is that last day, not the first day of the next month —
  the opposite direction from the early-morning case above, and the one that moves a figure
  forward across a close rather than back

#### Scenario: Every posting path uses the company's day

- **WHEN** a payment settlement, an approval accrual and a stock movement are each posted for the
  same company
- **THEN** all three entries derive `entry_date` in that company's timezone, by the same rule

#### Scenario: Two companies in different zones date the same instant differently

- **GIVEN** company A in a UTC+7 zone and company B in a UTC+0 zone
- **WHEN** an event is posted for each at the same instant, 22:00 UTC
- **THEN** A's entry is dated the following day and B's entry is dated that day, each being its own
  company's calendar day
