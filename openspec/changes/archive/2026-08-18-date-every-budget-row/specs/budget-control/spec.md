# budget-control

## MODIFIED Requirements

### Requirement: Append-Only Budget Ledger
The system SHALL record every budget change as a row in `budget_txn` and MUST NOT
update or delete existing rows. Balance is always derived by summation as
`amount_total + Σ ADJUST_INCREASE − Σ ADJUST_DECREASE + Σ TRANSFER_IN − Σ TRANSFER_OUT
− Σ RESERVE + Σ RELEASE`. ACTUAL MUST NOT be subtracted: it draws down an existing
reservation (see Outstanding Reservation Accounting), so the reserve that was never
released already represents the spend. Subtracting ACTUAL as well SHALL be treated as
a defect — it charges the budget twice for the same document.

Every `budget_txn` row SHALL carry `txn_date`: the calendar day of the event it records, resolved in
the company's own `company.timezone` by the same rule `journal_entry.entry_date` uses. It SHALL be
the day of the EVENT, not the day the row was inserted — the submit for a `RESERVE`, the settlement
for an `ACTUAL`, the release for a `RELEASE`, and the movement's effective day for a `TRANSFER` or
an `ADJUST`. A `TRANSFER_OUT` and its `TRANSFER_IN` SHALL carry the same date, as they already commit
in one transaction.

`created_at` SHALL remain what it is — when the system learned of the row — and SHALL NOT be read as
when the event happened. The two differ whenever a backdated movement is approved, whenever a
settlement is recorded the next morning, and across every timezone boundary; the ledger needs both
and must not conflate them.

#### Scenario: Every row states the day its event happened

- **WHEN** any `budget_txn` row is written
- **THEN** it carries a `txn_date` that is the company's calendar day for the event it records

#### Scenario: A reservation is dated by its submit, not by its insert

- **GIVEN** a document submitted on the company's 31 March
- **WHEN** its `RESERVE` rows are written
- **THEN** each carries `txn_date` 31 March, whatever instant the row was inserted at

#### Scenario: A transfer's two halves share one day

- **WHEN** an approved movement writes its `TRANSFER_OUT` and `TRANSFER_IN`
- **THEN** both carry the same `txn_date`, taken from the movement's effective day

#### Scenario: Balance is computed, never stored mutably
- GIVEN a budget with amount_total 1,000,000
- WHEN a RESERVE of 100,000 and a RELEASE of 40,000 are recorded
- THEN available balance equals amount_total minus reserve plus release
- AND `budget.amount_total` is never overwritten by these operations

#### Scenario: A fully consumed reservation is charged exactly once
- GIVEN a budget with amount_total 1,000,000
- WHEN a document reserves 100,000 and is then settled for an actual of 100,000
- THEN an ACTUAL of 100,000 is recorded and no RELEASE is recorded
- AND the available balance is 900,000, not 800,000

### Requirement: Derived-Balance Breakdown Query

The system SHALL provide a read that returns a budget's derived balance broken into its
components — `amount_total`, summed `ADJUST_INCREASE` / `ADJUST_DECREASE`, `TRANSFER_IN` /
`TRANSFER_OUT`, `RESERVE`, `ACTUAL`, `RELEASE`, and the resulting available — all summed from
`budget_txn` in the company base currency. `ACTUAL` SHALL be reported as a component and SHALL NOT
be subtracted from available: it draws down a reservation that already reduced the balance (see
`Append-Only Budget Ledger` and `Outstanding Reservation Accounting`), so subtracting it as well
would charge the budget twice. The read SHALL require `BUDGET_VIEW` and SHALL NOT mutate
`budget.amount_total`.

The read SHALL accept an optional as-of date and, when given one, SHALL fold only the `budget_txn`
rows whose `txn_date` is on or before it, so a figure stated for a past day can be reproduced. The
default SHALL be today, leaving the read's meaning unchanged for a caller that asks for none.

#### Scenario: A figure can be stated as of a past day

- **GIVEN** a budget whose ledger holds a RESERVE dated 20 June and another dated 5 July
- **WHEN** the breakdown is read as of 30 June
- **THEN** only the June reservation is folded into the figures

#### Scenario: Components reconcile to available

- **WHEN** a `BUDGET_VIEW` user requests a budget's breakdown
- **THEN** available equals `amount_total` + ADJUST_INCREASE − ADJUST_DECREASE + TRANSFER_IN −
  TRANSFER_OUT − RESERVE + RELEASE

#### Scenario: A settled document does not deduct twice

- **GIVEN** a budget with `amount_total` 1,000,000 whose ledger holds a RESERVE of 100,000, an
  ACTUAL of 90,000 and a RELEASE of 10,000 for one document
- **WHEN** a `BUDGET_VIEW` user requests its breakdown
- **THEN** `actual` is reported as 90,000 and available is 910,000 — not 820,000

### Requirement: Append-Only Ledger Read

The system SHALL provide a read of a budget's `budget_txn` entries (type, amount, source
document, remark, the day of the event `txn_date`, and the insert timestamp) ordered
most-recent-first, under `BUDGET_VIEW`. The read SHALL be strictly read-only and never alter the
ledger.

The read SHALL accept an optional as-of date and, when given one, SHALL return only the rows whose
`txn_date` is on or before it.

#### Scenario: Ledger entries are returned for a budget

- **WHEN** a `BUDGET_VIEW` user requests a budget's ledger
- **THEN** that budget's `budget_txn` rows are returned, newest first, each stating the day its
  event happened

#### Scenario: The ledger read can be bounded to a past day

- **WHEN** a `BUDGET_VIEW` user reads a budget's ledger as of a past date
- **THEN** only rows whose `txn_date` is on or before that date are returned
