## ADDED Requirements

### Requirement: Selectable Budgets Belong to Today's Fiscal Year

The selectable-budgets read SHALL return only `ACTIVE` budgets whose `fiscal_year_id` is the
company's `OPEN` fiscal year covering today in `company.timezone`; budgets of any other fiscal year
SHALL NOT be offered, even while still `ACTIVE`. When the read is made for an existing document
(`documentId`), a budget that document's lines inherited from its predecessor SHALL remain in the
result regardless of its fiscal year. When no open fiscal year covers today, the read SHALL return
an empty list.

#### Scenario: Last year's budgets are no longer offered

- **WHEN** on 2027-01-05 both 2026 and 2027 budgets coded `6.101` are `ACTIVE`
- **THEN** the selectable read offers only the 2027 `6.101`

#### Scenario: Inherited budget stays on its successor

- **WHEN** a successor created in January 2027 inherited a 2026 budget from its predecessor and
  the read is made with that successor's `documentId`
- **THEN** the inherited 2026 budget is included

### Requirement: Submit Refuses a Line Charging Another Year's Budget

Submitting a `requires_budget` document SHALL be refused when any line charges a budget whose
`fiscal_year_id` is not the open fiscal year covering the submit date (company-local), unless that
line's budget was inherited from the document's predecessor. The refusal SHALL be an explained
error naming the line and the budget's year. The check SHALL run before any `RESERVE` row is
written, so a refused submit leaves `budget_txn` untouched (invariant 2).

#### Scenario: December draft submitted in January

- **WHEN** a draft created on 2026-12-28 with a line charging a 2026 budget is submitted on
  2027-01-04
- **THEN** the submit is refused naming that line and year 2026, and no `budget_txn` row is written

#### Scenario: Re-pointed draft submits

- **WHEN** the requester changes that line to the 2027 budget of the same code and submits
- **THEN** the submit succeeds and reserves against the 2027 budget
