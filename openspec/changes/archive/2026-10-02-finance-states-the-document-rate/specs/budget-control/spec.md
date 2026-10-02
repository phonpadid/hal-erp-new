## ADDED Requirements

### Requirement: Restating a Rate Re-Reserves the Budget

When a document's rate is restated, the system SHALL release its outstanding reservation and take a
new one at the recomputed amount, in the same transaction as the restatement.

Both are ordinary ledger rows: a `RELEASE` for what was held and a `RESERVE` for what is now held.
The ledger SHALL NOT be updated in place and no row SHALL be deleted — the history of a document that
changed value is exactly the pair of rows that show it changing.

The new reservation SHALL be subject to the same coverage and over-limit rules as the original, so a
restatement that would take a budget past a `HARD_STOP` ceiling is refused and the document keeps the
hold it had. A refusal SHALL leave the ledger as it was: no release, no reserve, no half-applied pair.

The amount re-reserved SHALL be the **budget base**. Where a `BUDGET_RATE` exists for the pair the
budget basis is deliberately insulated from the daily rate, so restating the daily rate SHALL NOT
move the reservation at all. Where no `BUDGET_RATE` exists the budget basis follows the daily rate —
the same fallback the submit path applies — and the reservation moves with it. Which of the two
applies SHALL be decided the same way at restatement as at submit, so a document cannot change which
rate governs its budget by being restated.

#### Scenario: The hold follows the restated amount

- **GIVEN** a document holding a reservation taken at submit, and no `BUDGET_RATE` for its pair
- **WHEN** its rate is restated downward
- **THEN** the ledger gains a `RELEASE` for the old hold and a `RESERVE` for the new, smaller one

#### Scenario: A configured budget rate keeps the hold still

- **GIVEN** a document whose pair has a `BUDGET_RATE`
- **WHEN** its daily rate is restated
- **THEN** the reservation is unchanged, because the budget basis never depended on the daily rate

#### Scenario: A restatement that would breach the ceiling is refused

- **GIVEN** a budget under `HARD_STOP` whose remaining balance will not cover the higher amount
- **WHEN** a restatement would raise the document's budget base past it
- **THEN** the request is refused and the document keeps its original reservation

#### Scenario: A refused restatement writes nothing

- **WHEN** a restatement is refused for any reason
- **THEN** no `budget_txn` row was written, and the derived balance is what it was before

### Requirement: Restatement Takes the Reservation Lock

A restatement SHALL take the same `PESSIMISTIC_WRITE` lock on the budget that reserving takes, for
the whole release-and-reserve pair.

It reads a balance and writes against it, which is the shape that over-commits when two of them
interleave. Two restatements of documents charging one budget, or a restatement racing a submit, SHALL
serialise rather than both passing a ceiling check neither would pass second.

#### Scenario: Concurrent restatements do not over-commit

- **GIVEN** one budget with room for exactly one of two pending increases
- **WHEN** two restatements against it are attempted at once
- **THEN** one succeeds and the other is refused, and the budget is never over-committed
