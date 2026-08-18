# gl-journal

## ADDED Requirements

### Requirement: Expenses Skipped For Want Of A Budget Are Readable

The system SHALL expose a read-only, company-scoped read of the postings recorded `SKIPPED` whose
document has no `ACTUAL` budget transaction — the expenses that were never written to the ledger
because nothing had been charged to a budget.

Each SHALL carry its source type and id, the document it belongs to and that document's number,
status and total, so that what is missing from the books can be identified and decided about.

The read exists because the budget-to-ledger reconciliation cannot see this case. A document with no
budget produces no `ACTUAL` and no journal entry, so both books report zero, the difference is zero,
and a reconciliation without this read would certify the books at the exact moment an entire expense
is absent from both. A reconciliation that cannot see its own worst failure is worse than none,
because it is believed.

This read SHALL be separate from the undelivered-postings read and SHALL NOT change it. `SKIPPED`
stays terminal there for the reason it always did: the period close asks that read whether a month is
drained, and a month must not be blocked by a posting the engine already decided not to write. The
two reads ask different questions — one asks what the engine still owes, this asks what the engine
decided not to say.

The classification SHALL be derived at read time from the absence of `ACTUAL` rows, rather than
stored when the posting is skipped. `gl_posting_attempt` records no reason, and two different
outcomes are recorded identically — a posting skipped because its amount was zero, and one skipped
because there was no expense side to post. Deriving keeps this read from writing anything and uses
the same rule the posting engine used.

The read SHALL be permission-gated and SHALL NOT gate, block or delay a period close.

#### Scenario: A document with no budget appears

- **GIVEN** a settled document whose lines charged no budget, whose posting was recorded `SKIPPED`
- **WHEN** the read runs for that company
- **THEN** the document is listed with its number and total

#### Scenario: A posting skipped because there was nothing to post does not appear

- **GIVEN** a source recorded `SKIPPED` whose document did charge a budget
- **WHEN** the read runs
- **THEN** it is absent — the skip was an answer, not a missing expense

#### Scenario: The undelivered read is unchanged

- **WHEN** the undelivered-postings read runs
- **THEN** `SKIPPED` sources are still absent from it, and a period close is unaffected by anything
  this read returns

#### Scenario: The read is company-scoped and permission-gated

- **WHEN** the read runs for company A
- **THEN** no skipped posting of another company is returned, and a request without the required
  permission is rejected with 403
