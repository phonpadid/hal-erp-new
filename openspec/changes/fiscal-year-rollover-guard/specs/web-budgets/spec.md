## ADDED Requirements

### Requirement: The Budget List Reads One Fiscal Year at a Time

The budget list SHALL offer a fiscal-year filter listing every `fiscal_year` of the active company,
newest first, with closed years marked. It SHALL open on the year covering today in
`company.timezone`, falling back to the most recent `OPEN` year when none covers today. The chosen
year SHALL scope the paged list, the control points the grouped view joins to, and the tree view.
Clearing the filter SHALL list every year, as before. The year options SHALL be read with
`BUDGET_VIEW`, the same code as the list, and a failure to load them SHALL leave the list readable
across all years rather than replacing it with an error.

#### Scenario: Opens on the current year

- **WHEN** a `BUDGET_VIEW` user opens the budget list in 2027 and both 2026 and 2027 hold budgets
- **THEN** only the 2027 budgets and control points are shown, and the filter shows 2027

#### Scenario: Looking back at last year

- **WHEN** the user picks 2026 in the year filter
- **THEN** the list reloads from page 1 with only the 2026 budgets, and the control points follow

#### Scenario: Every year

- **WHEN** the user clears the year filter
- **THEN** budgets of every year are listed
