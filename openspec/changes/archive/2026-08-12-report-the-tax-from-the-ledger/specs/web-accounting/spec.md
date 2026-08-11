# web-accounting

## ADDED Requirements

### Requirement: The VAT Summary Formats Its Figures as Money

The VAT summary screen SHALL format both the input VAT and the withheld WHT with the base currency's
`decimal_places`, as every other amount in the app is formatted, and SHALL NOT render the raw string
the server returned.

#### Scenario: Figures carry the base currency's decimal places

- **GIVEN** a summary row whose input VAT is the decimal string `1000`
- **WHEN** the screen renders it in a company whose base currency has two decimal places
- **THEN** it is shown as `1,000.00`
