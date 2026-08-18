# reporting

## MODIFIED Requirements

### Requirement: Budget Movement Audit Trail Report

The system SHALL provide a chronological audit report of `budget_txn` movements for the active
company, each row showing the transaction type, amount, the day the movement happened (`txn_date`),
when the row was recorded (`created_at`), the originating document (`doc_no`, linked when present),
the remark, and the actor. Because the ledger is append-only, corrections SHALL appear as their own
rows; the report SHALL NOT hide or merge them.

Ordering and the date-range filter SHALL both use `txn_date` — the day the movement happened —
with `created_at` as the tie-break for rows sharing a day. A person asking for "the first half of
May" means movements that took effect then, not rows a server inserted then; a transfer effective
on 1 May and approved on the 20th belongs in the first half of May. This matches what the general
ledger already does with `entry_date`.

Both times SHALL be shown rather than one chosen for the reader. They answer different questions —
when it happened, and when the system learned of it — and an audit report is precisely where the
gap between them is worth seeing.

#### Scenario: Movement rows carry their source document

- **WHEN** a user runs the budget-audit report
- **THEN** each movement row shows its txn type, amount, the day it happened, when it was recorded,
  and a link to the originating document when one exists

#### Scenario: Chronological and filterable

- **WHEN** the user filters by a budget or department and a date range
- **THEN** only movements whose `txn_date` falls in that range are listed, ordered newest-first by
  that same day

#### Scenario: A backdated movement is filed under the day it took effect

- **GIVEN** a transfer effective on 1 May and approved on 20 May
- **WHEN** the user filters the first half of May
- **THEN** the movement is listed, and its row shows both 1 May and the 20 May recording time

#### Scenario: Corrections remain visible

- **WHEN** a correcting movement was appended to reverse an earlier one
- **THEN** both the original and the correcting rows appear in the audit trail
