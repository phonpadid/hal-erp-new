## ADDED Requirements

### Requirement: Report Viewer with Charts

The web app SHALL render reports using appropriate visualizations built on the PrimeVue `Chart`
component — bar / stacked-bar (volume, utilization), pie / donut (status distribution), and Pareto
(bar + cumulative-% line for spend) — alongside a drill-down data table. Chart components SHALL be
reusable across reports.

#### Scenario: Document status distribution renders as a donut

- **WHEN** the user opens the document-summary report
- **THEN** the status mix is shown as a donut chart with a supporting table

#### Scenario: Spend by vendor renders as a Pareto

- **WHEN** the user opens the spend-by-vendor report
- **THEN** vendor spend is shown as descending bars with a cumulative-% line, alongside a table

### Requirement: Report Filters

Reports with filters (fiscal year, department, date range) SHALL provide filter controls and
re-run the report when the filters are applied, sending the same filters to the CSV export.

#### Scenario: Applying a filter re-runs the report

- **WHEN** the user sets a date range and applies it
- **THEN** the chart and table refresh with data for the selected range

### Requirement: Currency-Aware Money Formatting

The web app SHALL format every monetary value using the currency's `decimal_places` and MUST NOT
coerce a money value to a JavaScript number for display.

#### Scenario: Amounts formatted by currency

- **WHEN** a report displays amounts in a currency with 0 decimal places
- **THEN** the amounts are rendered with no decimal digits

### Requirement: Theme-Token Styling

Charts and widgets SHALL use PrimeUI theme tokens for color and MUST NOT use hardcoded hex values,
so light and dark modes both render correctly, re-resolving colors when the theme changes.

#### Scenario: Charts adapt to dark mode

- **WHEN** the app switches to dark mode
- **THEN** chart colors follow the theme without hardcoded values

### Requirement: Export from the UI

The web app SHALL let the user export the currently viewed report as CSV, requesting it with the
same filters shown on screen; the download is fetched through the authenticated client.

#### Scenario: Export reflects current filters

- **WHEN** the user clicks export with a date range applied
- **THEN** the downloaded CSV contains only the filtered, permitted rows
