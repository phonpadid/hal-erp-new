# web-accounting

## ADDED Requirements

### Requirement: The VAT Summary Shows Whether a Month Has Been Filed

The VAT summary screen SHALL show, on each period's row, whether a return has been filed for it and
— when it has — the date and the amount that was claimed. A figure without its filed state invites
the same month being claimed twice on paper while the ledger says it was claimed once.

The screen SHALL offer a control to file a period, and SHALL offer it only for periods not yet filed,
only to a holder of the filing permission, and SHALL disable it for a period with nothing to claim.

The period sent SHALL be the whole calendar month the row reports, with its own last day.

Amounts SHALL be formatted with the base currency's decimal places.

#### Scenario: A filed month is marked as filed

- **GIVEN** a summary in which one period has a return and another does not
- **WHEN** the screen is shown
- **THEN** the period with a return shows its filed date and claimed amount, and the other shows that
  it is not filed

#### Scenario: The file control is offered only where filing is possible

- **GIVEN** a viewer holding the filing permission
- **WHEN** the screen is shown
- **THEN** the control appears only on periods not yet filed

#### Scenario: A reader is offered no file control

- **GIVEN** a viewer who may read the summary but not file
- **WHEN** the screen is shown
- **THEN** no file control appears

#### Scenario: A period with nothing to claim cannot be filed from the screen

- **GIVEN** a period whose input VAT is zero
- **WHEN** the screen is shown
- **THEN** its file control is disabled

#### Scenario: Filing sends the whole calendar month

- **GIVEN** a period row for a month whose last day is not the 30th
- **WHEN** it is filed
- **THEN** the request names that month's first and last day
