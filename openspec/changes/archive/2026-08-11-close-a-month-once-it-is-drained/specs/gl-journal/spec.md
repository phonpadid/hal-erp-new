## MODIFIED Requirements

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

- **WHEN** a payment settlement, an approval accrual, a claim settlement or a stock movement posts
- **THEN** its entry was written through the one constructor, with its balance asserted, its
  `entry_date` resolved in the posting company's timezone, and that day checked against the
  company's accounting periods
