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

No `budget_txn` row SHALL be written against a budget whose `status` is `CLOSED`. The refusal SHALL
happen where budget rows are written — the single point every `budget_txn` passes through — so that
no call site can bypass it and a writer added later is covered by construction, exactly as
`gl-journal` refuses an entry dated in a closed period at its one constructor. The refusal SHALL
name the budget and its fiscal year rather than failing anonymously.

This is what makes a closed year closed on the budget side: a re-queued posting delivering late, an
adjustment approved against last year, or a capability written after this one cannot quietly consume
an appropriation whose year is finished.

#### Scenario: A closed year's appropriation refuses new rows

- **GIVEN** a budget whose fiscal year has been closed
- **WHEN** anything attempts to write a `RESERVE`, `ACTUAL`, `RELEASE`, `TRANSFER` or `ADJUST`
  against it
- **THEN** the write is refused, naming the budget and its year, and no row is written

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
