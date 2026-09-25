## ADDED Requirements

### Requirement: A Draft's Day-Money-Moved Can Be Corrected

The system SHALL accept a change to `document.money_moved_on` while the document is `DRAFT`, and
SHALL reject any such change once it has left `DRAFT`. The write SHALL be gated on the `DOC_CREATE`
permission code and scoped to the active company, as the other draft corrections are.

This column is not a display field. It is the `txn_date` of every `budget_txn` row the document
writes — RESERVE at submit, ACTUAL and RELEASE at settle — so it decides which period the spend is
reported in. Written only at creation, a document whose day was wrong reported its spend in the wrong
period for good: nothing at submit requires the value, so the document completed normally and no
refusal ever drew attention to it.

A stated day SHALL be held to the same guards the creation was held to, and for the same reasons:

- the document type's `records_past_events` MUST be set, otherwise the type cannot state the day its
  money moved at all;
- the day MUST NOT be in the future;
- a day before today SHALL require the `DOC_BACKDATE` permission code.

A request failing any of these SHALL be rejected and the document SHALL be left unchanged.

Clearing `document.money_moved_on` SHALL be accepted, and SHALL NOT require `DOC_BACKDATE`. `NULL` on
this column means the ledger dates its rows by the clock, which is what most documents do; a draft of
a type that has since lost `records_past_events` holds a day it may no longer state, and must be able
to drop it. There is no future day and no past day in a request that states none, so the guards above
have nothing to check.

The correction SHALL NOT alter any existing `budget_txn` row. Those are append-only (invariant 2),
and the `DRAFT`-only rule is what keeps that true: a draft has not reserved anything, so no row
carrying this date exists yet when the correction is made.

#### Scenario: A draft's day money moved is corrected

- **GIVEN** a `DRAFT` document of a `records_past_events` type stating a day in the past
- **WHEN** a caller holding `DOC_BACKDATE` states a different past day
- **THEN** the change is accepted and the document carries the new day

#### Scenario: The corrected day dates the budget rows at submit

- **GIVEN** a `DRAFT` document whose day money moved was corrected
- **WHEN** it is submitted and reserves budget
- **THEN** the `budget_txn` rows carry the corrected day as their `txn_date`

#### Scenario: The day cannot be changed under approval

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** its `money_moved_on` is changed
- **THEN** the request is rejected and the document is unchanged

#### Scenario: The day cannot be changed after approval

- **GIVEN** a `COMPLETED` document
- **WHEN** its `money_moved_on` is changed
- **THEN** the request is rejected and no `budget_txn` row is altered

#### Scenario: A type that does not record past events is refused

- **GIVEN** a `DRAFT` document whose type has `records_past_events` false
- **WHEN** a day is stated for it
- **THEN** the request is rejected and the document is unchanged

#### Scenario: A future day is refused

- **GIVEN** a `DRAFT` document of a `records_past_events` type
- **WHEN** a day after today in the company's timezone is stated
- **THEN** the request is rejected and the document is unchanged

#### Scenario: Backdating without the permission is refused

- **GIVEN** a caller lacking the `DOC_BACKDATE` permission code
- **WHEN** they state a day before today on a `DRAFT` document
- **THEN** the request is rejected and the document is unchanged

#### Scenario: The day can be cleared without DOC_BACKDATE

- **GIVEN** a `DRAFT` document stating a past day, and a caller lacking `DOC_BACKDATE`
- **WHEN** they clear `money_moved_on`
- **THEN** the change is accepted and the document states no day

#### Scenario: A caller without DOC_CREATE cannot correct the day

- **GIVEN** a user lacking the `DOC_CREATE` permission code
- **WHEN** they change a draft's `money_moved_on`
- **THEN** the request is rejected
