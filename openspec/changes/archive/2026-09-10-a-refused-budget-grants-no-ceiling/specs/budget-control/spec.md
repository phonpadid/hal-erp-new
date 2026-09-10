## MODIFIED Requirements

### Requirement: Availability Is Checked at Governing Control Points

The system SHALL check budget availability at the governing control points of the budgets a
document charges, not at the `budget` rows themselves. Reserved amounts SHALL first be
grouped by `budget_id` as today, then summed up to each governing control point, so that a
document charging several budgets governed by the same control point is checked once against
their combined amount. Every governing control point SHALL be checked; passing the most
specific one SHALL NOT exempt a submission from a wider one. Posting SHALL remain unchanged:
`budget_txn` rows are written against the `budget_id` of each line's budget.

The available amount at a control point SHALL be derived, never stored on the control point:
it is the sum of `budget.amount_total` over the governed budgets **whose status is counted**,
adjusted by the `budget_txn` rows of **every** governed budget using the invariant-3 formula —
plus ADJUST_INCREASE, minus ADJUST_DECREASE, plus TRANSFER_IN, minus TRANSFER_OUT, minus
RESERVE, plus RELEASE, with ACTUAL never subtracted.

A counted status is `ACTIVE` or `CLOSED` — the same set the rest of the system totals by. A
`DRAFT` budget is a proposal nobody has approved, a `REJECTED` one is a proposal somebody
refused, and an `INACTIVE` one is money withdrawn from use; none of the three is an
appropriation, and a ceiling that adds them lets the budgets beside them spend money that was
never granted. The ceiling used to sum every governed row regardless of status, and a rejected
budget of 23,056,000 was observed granting exactly that much room to a sibling whose own
appropriation was zero, under a ladder blocking at 100 percent that was working as written.

The two halves are deliberately asymmetric. A budget that leaves `ACTIVE` carrying outstanding
reservations does not release them by changing status, so its ledger rows SHALL keep counting
against the ceiling: dropping them would hand the group back money it is still holding. Only
`ACTIVE` budgets are selectable for a document, so a `DRAFT` or `REJECTED` budget has no ledger
rows to count either way; the rule is stated for `INACTIVE`, which the status table permits.

Which budgets a control point governs SHALL NOT change. Coverage answers whether a budget is
checked by anything at all, and every `ACTIVE` budget SHALL still be governed; only the money
arithmetic distinguishes statuses.

#### Scenario: Lines under one control point are checked against their total

- **GIVEN** a control point with 100,000 available governing budgets A, B and C
- **AND** each of A, B and C individually has more than 40,000 available
- **WHEN** a document with three lines of 40,000 charging A, B and C is submitted
- **THEN** the submission is refused, because 120,000 exceeds the control point's 100,000

#### Scenario: A wider control point still blocks when a narrower one passes

- **GIVEN** a budget governed by a category control point with 500,000 available and by a
  department control point with 10,000 available
- **WHEN** a document reserving 50,000 against that budget is submitted
- **THEN** the submission is refused by the department control point

#### Scenario: Posting still happens at the budget

- **GIVEN** a document with two lines charging two different budgets governed by one control
  point
- **WHEN** the document is submitted and passes the control point's check
- **THEN** one RESERVE is written against each `budget_id`, and none against the control point

#### Scenario: A single-budget control point behaves exactly as before

- **GIVEN** a control point whose node is a budget's own node and whose department node is that
  budget's own `department_id`, governing only that budget
- **WHEN** a document reserves against that budget
- **THEN** the accepted and refused amounts are identical to checking that budget row alone

#### Scenario: A rejected budget grants no ceiling

- **GIVEN** a control point governing an `ACTIVE` budget of 0 and a `REJECTED` budget of
  23,056,000 at the same node
- **WHEN** its available amount is derived
- **THEN** the ceiling is 0, not 23,056,000

#### Scenario: A rejected budget cannot be spent through

- **GIVEN** that control point and a ladder blocking at 100 percent
- **WHEN** a document charging the `ACTIVE` budget for 23,056,000 is submitted
- **THEN** it is refused with `BUDGET_EXCEEDED`

#### Scenario: A draft budget grants no ceiling

- **GIVEN** a control point governing an `ACTIVE` budget of 1,000,000 and a `DRAFT` budget of
  500,000 awaiting the approval of the plan carrying it
- **WHEN** its available amount is derived
- **THEN** the ceiling is 1,000,000

#### Scenario: A closed budget still counts

- **GIVEN** a control point governing a `CLOSED` budget of 400,000 and an `ACTIVE` one of 600,000
- **WHEN** its available amount is derived
- **THEN** the ceiling is 1,000,000 — a closed year records what was appropriated and spent

#### Scenario: An inactive budget keeps its commitments against the ceiling

- **GIVEN** a control point governing an `ACTIVE` budget of 1,000,000 and an `INACTIVE` budget of
  200,000 holding an outstanding RESERVE of 50,000
- **WHEN** its available amount is derived
- **THEN** the ceiling is 1,000,000 and used is 50,000, so available is 950,000

#### Scenario: Every read of the ceiling agrees

- **GIVEN** a control point governing budgets of mixed status
- **WHEN** its ceiling is read from the single-point balance, from the batched list, and from the
  breakdown behind its detail screen
- **THEN** the three amounts are identical

#### Scenario: Coverage is unchanged by status

- **GIVEN** a control point governing an `ACTIVE` budget and a `REJECTED` one
- **WHEN** the budgets it governs are listed
- **THEN** both are reported, because governing is not the same question as counting
