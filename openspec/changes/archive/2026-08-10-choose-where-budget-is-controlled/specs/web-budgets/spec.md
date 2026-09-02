## ADDED Requirements

### Requirement: Governing Control Points on the Budget Detail

The web app SHALL show, on a budget's detail, every active `budget_control_point` that
governs that budget, with each control point's account node, department node, and derived
available amount, formatted to the company base currency's `decimal_places` and never
carried as a JS number. A budget's own available balance is no longer the amount that decides
whether a document can be submitted against it; without seeing the governing control points a
user cannot tell why a line that appears to have room was refused, and the usual response to
an unexplained refusal is to charge the spend to a different line, which destroys the
reporting the budget exists to produce.

The panel SHALL be gated on `BUDGET_VIEW` like the other amount-bearing budget reads, and
SHALL be scoped to the active company.

#### Scenario: Governing control points are listed with their available amounts

- **GIVEN** a budget governed by a category control point and a department control point
- **WHEN** the user opens the budget's detail
- **THEN** both control points are listed with their account node, department node, and
  available amount

#### Scenario: The binding control point is distinguishable

- **GIVEN** a budget with 5,000,000 available governed by a control point with 10,000 available
- **WHEN** the user opens the budget's detail
- **THEN** the control point with the lowest available amount is identifiable as the one that
  will refuse first

#### Scenario: Control point amounts honor the currency decimal places

- **GIVEN** the company base currency has 3 decimal places
- **WHEN** the governing control points are shown
- **THEN** every available amount is formatted with 3 decimal places

#### Scenario: The panel is permission-gated

- **WHEN** a user without `BUDGET_VIEW` opens a budget detail they can otherwise reach
- **THEN** the governing control points panel is not shown

### Requirement: Over-Budget Refusal Names the Blocking Control Point

When a submission is refused with `BUDGET_EXCEEDED`, the web app SHALL surface the blocking
control point and its available amount as reported by the server, rather than only the budget
the user selected.

#### Scenario: The refusal message identifies the control point

- **GIVEN** a submission refused by a control point with 10,000 available
- **WHEN** the error is shown to the user
- **THEN** the message identifies that control point and its available amount of 10,000
