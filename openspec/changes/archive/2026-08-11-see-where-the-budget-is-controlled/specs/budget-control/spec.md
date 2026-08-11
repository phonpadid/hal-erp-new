## MODIFIED Requirements

### Requirement: Control Point Administration

The system SHALL let users holding `BUDGET_MANAGE` create, update, deactivate and list
`budget_control_point` rows in the active company, and SHALL expose the derived available
amount at a control point to users holding `BUDGET_VIEW`. All reads and writes SHALL be
scoped to the active company (invariant 1). No new permission code SHALL be introduced.

The list read SHALL return, for each control point, its derived `ceiling`, `used` and `available`
and the ids of the budgets it governs, alongside its configuration fields. Without them a caller
showing a list of control points must issue one balance request per row, and a caller grouping
budgets by their governing point must issue one coverage request per budget. The derived figures
SHALL be computed the same way as the single-control-point balance read — never stored on the
control point and never summed by the caller.

#### Scenario: Control point administration is permission-gated

- **WHEN** a request without `BUDGET_MANAGE` tries to create a control point
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Control point balance read is permission-gated

- **WHEN** a request without `BUDGET_VIEW` tries to read a control point's available amount
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Control point reads are company-scoped

- **WHEN** a user lists control points while company A is active
- **THEN** only company A's control points are returned

#### Scenario: The list carries each point's derived figures

- **GIVEN** a control point governing budgets whose `amount_total` sums to 534,000,000, with
  487,208,500 reserved against them
- **WHEN** a `BUDGET_VIEW` user lists control points
- **THEN** that row reports a ceiling of 534,000,000, used of 487,208,500 and available of
  46,791,500

#### Scenario: The list carries the ids of the budgets each point governs

- **GIVEN** a control point governing six budgets
- **WHEN** a `BUDGET_VIEW` user lists control points
- **THEN** that row reports the ids of all six budgets

#### Scenario: List figures agree with the single-point balance read

- **WHEN** a control point's available is read from the list and from its own balance endpoint
- **THEN** the two amounts are identical

#### Scenario: A point governing nothing reports zero, not unlimited

- **GIVEN** an active control point that governs no budget
- **WHEN** a `BUDGET_VIEW` user lists control points
- **THEN** that row reports a ceiling of 0, available of 0, and no governed budget ids
