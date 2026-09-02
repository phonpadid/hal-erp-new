# accounting-period

## MODIFIED Requirements

### Requirement: A Closed Period Refuses New Entries, And A Refused Posting Is Not Lost

The system SHALL refuse to write a `journal_entry` whose `entry_date` falls inside a `CLOSED`
period of that company. The refusal SHALL happen where every entry is constructed, so that no
posting path can bypass it and a path added later is covered by construction.

A refused posting SHALL become a recorded posting failure — queryable on the undelivered-postings
read and re-queueable — exactly as any other failed posting does. It SHALL NOT be silently dropped,
and it SHALL NOT be redirected into a later open period: moving a figure to a month in which it did
not happen is a decision for a person, not for a posting engine.

A date that no declared period covers SHALL be posted normally. A company that has declared no
period is therefore unaffected in every respect.

#### Scenario: An entry dated in a closed period is refused

- **GIVEN** a closed period covering August
- **WHEN** a posting would write an entry dated inside August
- **THEN** no entry is written and the posting fails

#### Scenario: The refusal is visible and recoverable

- **WHEN** a posting is refused because its period is closed
- **THEN** it appears on the undelivered-postings read with the reason, and can be re-queued once
  the period is reopened

#### Scenario: A date in an open period posts

- **WHEN** a posting would write an entry dated inside an `OPEN` period
- **THEN** the entry is written normally

#### Scenario: A company with no periods is unaffected

- **GIVEN** a company that has declared no accounting period
- **WHEN** any posting runs for it
- **THEN** the entry is written exactly as it was before periods existed

#### Scenario: The guard covers every posting path

- **WHEN** a payment settlement, an approval accrual or a stock movement would write into a closed
  period
- **THEN** each is refused, because all of them construct their entry at the same point
