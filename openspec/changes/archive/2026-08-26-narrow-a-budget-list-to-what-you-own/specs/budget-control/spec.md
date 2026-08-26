## ADDED Requirements

### Requirement: Narrowing The Budget List

The budget list read MAY accept an optional department filter and an optional status filter, and where given each SHALL be applied to the query **before** the page window.

`total` therefore counts the narrowed set, and a matching row on any page is reachable from the
first. Each SHALL narrow the already-scoped set and
SHALL NOT widen it: a department of another company matches nothing, because company scope
(invariant 1) has already been applied. The filters SHALL compose with each other and with any
search term, as a conjunction.

Neither filter SHALL have a default that hides rows. A list requested with no status filter SHALL
return every status, so that budgets a plan proposed and had turned down are absent from a reader's
view only because that reader chose to exclude them.

The system SHALL provide the department options for that filter through a read gated by the same
permission as the budget list itself, returning the departments that hold at least one budget in the
active company. The general department directory requires a different permission, which a holder of
the budget-read permission need not have — sourcing the options there would present an empty filter
to exactly the readers it exists to serve. That read SHALL return identifying fields only, and no
amount, derived balance, or ledger row.

#### Scenario: A department filter narrows to that department

- **GIVEN** budgets belonging to more than one department in the active company
- **WHEN** the list is requested filtered to one department
- **THEN** only that department's budgets are returned, and `total` is their count

#### Scenario: A status filter sets aside rejected proposals

- **GIVEN** a company holding both ACTIVE and REJECTED budgets
- **WHEN** the list is requested filtered to ACTIVE
- **THEN** no REJECTED budget is returned or counted

#### Scenario: No status filter shows every status

- **GIVEN** a company holding budgets in more than one status
- **WHEN** the list is requested with no status filter
- **THEN** budgets of every status are returned

#### Scenario: Filters compose with a search term

- **GIVEN** a department whose budgets include some matching a term and some not
- **WHEN** the list is requested with both that department and that term
- **THEN** only that department's matching budgets are returned

#### Scenario: A filter cannot reach another company's rows

- **GIVEN** a department belonging to another company
- **WHEN** the list is filtered by it from the active company
- **THEN** nothing is returned, and no other company's budget is counted

#### Scenario: Filter options are readable by a budget reader

- **GIVEN** a user holding the budget-read permission and not the department-directory permission
- **WHEN** they request the departments available to filter by
- **THEN** they receive the departments holding a budget in their company, with no amounts

#### Scenario: A department with no budget is not offered

- **GIVEN** a department in the active company holding no budget
- **WHEN** the filter options are requested
- **THEN** that department is not among them
