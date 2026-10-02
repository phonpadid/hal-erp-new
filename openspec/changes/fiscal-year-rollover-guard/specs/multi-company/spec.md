## ADDED Requirements

### Requirement: Fiscal Years of a Company Do Not Overlap

Creating or editing a `fiscal_year` SHALL be refused when its `start_date`..`end_date` overlaps any
other `fiscal_year` of the same company, or when `end_date` is not after `start_date`. Fiscal years
of different companies are independent.

#### Scenario: Overlapping year is refused

- **WHEN** fiscal year 2026 spans 2026-01-01..2026-12-31 and an admin creates 2027 starting
  2026-12-01
- **THEN** the request is refused with an overlap error and no row is written

#### Scenario: Adjacent year is accepted

- **WHEN** the admin creates 2027 spanning 2027-01-01..2027-12-31
- **THEN** the fiscal year is created `OPEN`
