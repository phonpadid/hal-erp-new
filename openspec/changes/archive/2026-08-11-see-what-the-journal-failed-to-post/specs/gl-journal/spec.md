## ADDED Requirements

### Requirement: Every Entry Is Written Through One Balanced Constructor

The system SHALL persist a `journal_entry` and its `journal_line` rows through a single
constructor, and no posting path SHALL build them any other way. The constructor SHALL reject an
entry whose `Σ debit` differs from its `Σ credit` by any amount before anything is persisted, and
SHALL resolve `entry_date` by the company-day rule (see `Entry Date Is The Posting Company's Own
Calendar Day`). This makes `Balanced Entry Invariant` a check rather than a property of how each
path happens to be written: today two of the four paths assert it and two are balanced only by
construction, which holds until the next edit.

#### Scenario: An unbalanced draft is refused before anything is written

- **WHEN** a posting path offers lines whose debits and credits differ
- **THEN** the constructor throws naming the source, and no `journal_entry` and no `journal_line`
  row exists for it

#### Scenario: Every path is constructed the same way

- **WHEN** a payment settlement, an approval accrual, a claim settlement or a stock movement posts
- **THEN** its entry was written through the one constructor, with its balance asserted and its
  `entry_date` resolved in the posting company's timezone

### Requirement: Every Posting Attempt Records Its Outcome

The system SHALL record the outcome of every posting attempt in a `gl_posting_attempt` row, one per
`(company_id, source_type, source_id)` — the same key `journal_entry` is unique on — carrying a
`status` of `PENDING`, `POSTED`, `SKIPPED` or `FAILED`, an `attempts` count and a `last_error`.
`gl_posting_attempt` is a work record, not a ledger: its rows change status in place, and it SHALL
NOT be treated as append-only. `journal_entry` remains the authority on whether a posting happened;
the row records what was tried and what went wrong.

A source that legitimately posts nothing SHALL be recorded `SKIPPED`, terminally — a settlement with
no `budget_txn` ACTUAL row, an accruing document that cut no budget, a `RESERVE` or `RELEASE` stock
row, and an intra-company transfer. Recording the skip is what lets the undelivered-postings read
below stay free of business rules: without it the read would have to re-derive every "nothing to
post" condition in a second place, where it can drift from the posting engine silently.

Recording an outcome SHALL NOT affect the business transaction that triggered the posting, which has
already committed (see `Config-Driven System Account Roles`).

#### Scenario: A successful posting is recorded

- **WHEN** a posting produces a balanced entry
- **THEN** its row is `POSTED`

#### Scenario: A failure is recorded, not only logged

- **GIVEN** a company with no account mapped to a role the posting needs
- **WHEN** the posting is attempted
- **THEN** the payment, approval or stock movement is unaffected, and a row exists carrying the
  failure and its message

#### Scenario: A legitimate no-op is recorded as skipped, not as a failure

- **WHEN** a settled document carrying no `budget_txn` ACTUAL row is posted
- **THEN** no entry is written and its row is `SKIPPED`, distinguishable from a failure

#### Scenario: A reservation is skipped rather than owed forever

- **WHEN** a `RESERVE` or `RELEASE` stock row is posted
- **THEN** no entry is written, its row is `SKIPPED`, and it is never reported as undelivered

### Requirement: Undelivered Postings Are Queryable

The system SHALL expose a read-only, company-scoped query, gated by `GL_VIEW`, returning the
postings that are owed and undelivered: sources having no `journal_entry` and no
`gl_posting_attempt` row in a terminal state (`POSTED` or `SKIPPED`). Each SHALL carry its source
type and id, its attempt count, its last error and its status. The read MUST NOT mutate any ledger.

A `FAILED` row SHALL remain on this read. The attempt bound stops the retrying, not the debt: a
posting nobody will retry automatically is the one most in need of being seen.

This read is what a period close will ask before allowing a period to be closed, so it SHALL be
answerable for a date range.

#### Scenario: A failed posting is visible

- **GIVEN** a posting that failed because a role was unmapped
- **WHEN** the undelivered-postings read runs for that company
- **THEN** the source is listed with its attempt count and the role that was missing

#### Scenario: Posted and skipped sources are not listed

- **WHEN** the read runs
- **THEN** sources whose entry exists, and sources recorded `SKIPPED`, are absent

#### Scenario: The read is company-scoped and permission-gated

- **WHEN** a `GL_VIEW` user in company A runs the read
- **THEN** only company A's undelivered postings are returned, and a request without `GL_VIEW` is
  rejected with 403

### Requirement: Retries Are Bounded and Missed Postings Are Reconciled

The system SHALL drain postings that are owed on an interval. A row SHALL be claimed with
`LockMode.PESSIMISTIC_WRITE` and `SKIP LOCKED` before being attempted, so two concurrent sweeps
cannot both post one source and a slow row does not block the rows behind it. `attempts` SHALL be
incremented and `last_error` stored on each failure, and the row SHALL become `FAILED` at its bound
rather than being retried forever.

The same interval SHALL additionally reconcile: over a bounded recent window it SHALL find sources
that are owed a posting and have **no** `gl_posting_attempt` row at all, and record them `PENDING`
so the retry path picks them up. This covers the posting lost when the process stops between the
business transaction committing and the in-process listener running — a case that produces no row,
no exception and no log line, and is therefore invisible to a retry that reads only the table. The
reconciled sources SHALL be settled payments, fully approved documents of a type that accrues, and
`stock_txn` rows — and a posting path added later SHALL extend this enumeration, or its sources will
never be reconciled.

Reconciliation SHALL NOT post directly; it SHALL only record what is owed, so exactly one code path
attempts a posting and counts its attempts.

#### Scenario: A transient failure is retried

- **GIVEN** a row whose first attempt failed and whose attempts are under the bound
- **WHEN** the sweep runs again
- **THEN** the posting is attempted again, with `attempts` incremented and `last_error` recorded

#### Scenario: A permanent failure stops being retried

- **GIVEN** a row that has failed up to its bound
- **WHEN** the sweep runs again
- **THEN** the row is `FAILED`, is not attempted, and keeps its `last_error`

#### Scenario: Two sweeps post one source once

- **GIVEN** one owed posting and two sweeps running concurrently
- **WHEN** both attempt to claim it
- **THEN** exactly one `journal_entry` exists for that source

#### Scenario: A posting lost to a restart is found

- **GIVEN** a settled payment whose posting never ran, so it has no entry and no row
- **WHEN** the reconciliation pass runs within its window
- **THEN** a `PENDING` row is recorded for it and the next sweep posts it

#### Scenario: Reconciliation does not re-post what is already posted

- **WHEN** the reconciliation pass runs over a window containing sources that posted successfully
- **THEN** no row is recorded for them and no second entry is written

### Requirement: A Failed Posting Can Be Re-Queued

The system SHALL let a user holding `GL_POST_RETRY` return a `FAILED` row to `PENDING` with its
`attempts` reset, so the next sweep attempts it again. `last_error` SHALL be retained, so the record
of what went wrong survives the retry. The operation SHALL be company-scoped and SHALL queue the
work rather than posting inline, keeping one code path that attempts a posting.

Without this the attempt bound would make a failed posting unpostable forever: an operator who reads
the undelivered list, maps the account that was missing, and has no way to complete the posting.

#### Scenario: Re-queuing lets a fixed posting complete

- **GIVEN** a `FAILED` posting whose missing account role has since been mapped
- **WHEN** a `GL_POST_RETRY` user re-queues it and the sweep runs
- **THEN** the entry is posted and the row becomes `POSTED`

#### Scenario: Re-queuing is permission-gated and company-scoped

- **WHEN** a request without `GL_POST_RETRY`, or one for another company's row, re-queues a posting
- **THEN** it is rejected and the row is unchanged

#### Scenario: Only a failed posting is re-queued

- **WHEN** a re-queue is attempted for a row that is `POSTED` or `SKIPPED`
- **THEN** it is rejected and no second entry is ever written for that source
