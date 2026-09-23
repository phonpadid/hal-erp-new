## ADDED Requirements

### Requirement: An Already-Existing Successor Fulfils the Obligation

A sweep SHALL mark a `PENDING` `pending_successor` row `DONE` without creating another document,
and SHALL NOT count the pass as a failed attempt, when the source document already has a live
successor (status not `REJECTED`/`CANCELLED`) of the row's `successor_type_id`. The obligation is that the source document has its successor, not that the sweep
inserted it. A sweep that loses a creation race to a manual create-from SHALL record that attempt
as a transient failure, and the next sweep SHALL find the manually created successor and mark the
row `DONE`.

#### Scenario: A hand-raised successor satisfies the outbox
- **GIVEN** a `PENDING` row for `PROC → PO` and a `PO` already created from that `PROC` by hand
- **WHEN** the sweep runs
- **THEN** the row is `DONE`, `attempts` is unchanged, and exactly one `PO` references the `PROC`

#### Scenario: Losing the race is transient
- **GIVEN** a `PENDING` row whose sweep inserts concurrently with a manual create-from of the same pairing
- **WHEN** the sweep's insert loses the uniqueness race
- **THEN** the row stays `PENDING` with `attempts` incremented, and the next sweep marks it `DONE` because the manual successor exists
