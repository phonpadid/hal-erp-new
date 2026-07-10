## ADDED Requirements

### Requirement: Detail Summary Stat Tiles

The document detail view SHALL present the document's headline figures as a scannable
stat-tile row, rendered with the shared KPI tile component, positioned between the hero
header and the detail content sections. The row SHALL include the document Total (with its
currency code), the number of Line items, and the number of Attachments. When the document's
currency differs from the company base currency, the row SHALL additionally include the Base
total (with the base-currency code) and the locked Exchange rate; for a document already in
the base currency these two tiles SHALL be omitted to avoid redundant information. When the
document has no header total set, the Total tile SHALL fall back to the summed line-item
total so it never shows an empty value while the line-items footer shows a figure. Monetary
tile values SHALL be formatted using the relevant currency's `decimal_places`, and money
SHALL never be rendered from a JavaScript number.

To avoid duplication, each figure SHALL appear once: the document Status SHALL be shown only
by the hero header status badge (not repeated as a tile); the Total SHALL be shown only in
the stat-tile row (not repeated as a hero headline); and the redundant "Summary" descriptive
card SHALL be removed, with its non-duplicated descriptive fields (vendor and predecessor
reference) relocated to the hero header meta line.

This requirement changes only the presentation of figures the detail view already loads;
it introduces no new data, no additional server calls, and no change to company scope,
permissions, or the authoritative document state. The descriptive fields that are not
headline figures (vendor, rate-locked timestamp, predecessor reference, field values, line
items, approval log, attachments) SHALL remain available on the page.

#### Scenario: Stat tiles render on the detail view

- **WHEN** a `DOC_VIEW` user opens a document detail
- **THEN** a stat-tile row is shown with tiles for Total (with currency code), Line items
  count, and Attachments count, above the detail content sections

#### Scenario: No duplicated figures across the page

- **WHEN** a `DOC_VIEW` user opens a document detail
- **THEN** the status appears only on the hero header badge (no status tile), the total
  appears only in the stat-tile row (no hero headline total), and there is no separate
  "Summary" card repeating currency or rate-locked date

#### Scenario: Total tile falls back to the line-item total

- **WHEN** the document has no header total set but has line items
- **THEN** the Total tile shows the summed line-item total (formatted per currency), matching
  the line-items footer, instead of an empty value

#### Scenario: Base-currency and exchange-rate tiles appear only for foreign currency

- **WHEN** the opened document's currency differs from the company base currency
- **THEN** the row additionally shows a Base total tile (with the base-currency code) and an
  Exchange rate tile
- **WHEN** the opened document is already in the company base currency
- **THEN** the Base total and Exchange rate tiles are omitted

#### Scenario: Count tiles reflect the document contents

- **WHEN** the document has N line items and M attachments
- **THEN** the Line items tile shows N and the Attachments tile shows M

#### Scenario: Monetary tiles respect currency decimal places

- **WHEN** the Total and Base total tiles are rendered
- **THEN** each amount is formatted using its currency's `decimal_places` and is not derived
  from a JavaScript number

#### Scenario: Empty line-item columns are hidden

- **WHEN** an optional line-item column (item, GL account, description, base amount, received
  quantity / line status) has no value on any row
- **THEN** that column is not shown, so the line-items table does not render a column of empty
  placeholders

#### Scenario: Only filled field values are shown

- **WHEN** the document's form fields include values that were left blank
- **THEN** only the fields that have a value are listed, and the Fields card is hidden when no
  field has a value

#### Scenario: Header presented as a status-stamped ticket with breadcrumb

- **WHEN** a `DOC_VIEW` user opens a document detail
- **THEN** a breadcrumb (documents list / document type / document number) is shown above a
  header that carries a status-colored left stripe, the document-type label, the document
  number, and a status badge, with the available actions grouped alongside the header

#### Scenario: Approval history presented as a stepper

- **WHEN** the document has approval-log entries and/or a current pending step
- **THEN** the approval history is rendered as a stepper — each acted step a completed node
  with a connector, and the current waiting step an emphasized (active) node — and an empty
  state is shown when there are no steps
