## ADDED Requirements

### Requirement: Document List Filtering

The documents list page SHALL provide a filter bar that drives server-side filtering of the
company-scoped list. The filters SHALL include document status (multi-select), a created-date
range, a document-number search, and an amount range, which are available to any `DOC_VIEW` user.
The filter bar SHALL additionally offer document type, department, and vendor filters whose option
lists come from privileged reads; each such option-backed filter SHALL be shown only when the user
holds the corresponding read permission (`DOC_CREATE` for type, `DEPARTMENT_VIEW` for department,
`MASTER_VIEW` for vendor), mirroring the server's scope rules. Changing any filter SHALL request the
list from the server with the corresponding query parameters and reset to the first page. The
document-number search SHALL be performed server-side (replacing any client-only search that
filtered just the loaded page), so results reflect the full dataset, not only the current page.
Amount-range inputs SHALL be handled as strings and SHALL NOT be coerced to a JavaScript number.
Filter labels SHALL be rendered through the i18n layer in both `la` and `en`.

#### Scenario: Filtering by status requeries the server

- **WHEN** a `DOC_VIEW` user selects one or more statuses in the filter bar
- **THEN** the app requests the list with those statuses as query parameters, resets to page 1, and
  shows the matching documents across the full dataset

#### Scenario: Document-number search is server-side

- **WHEN** the user types a document number fragment into the search
- **THEN** the app sends it as a server query parameter and the results include matches beyond the
  currently loaded page

#### Scenario: Amount range is sent as strings

- **WHEN** the user enters a minimum and maximum amount
- **THEN** the values are sent to the server as decimal strings and are never converted to a
  JavaScript number on the client

#### Scenario: Clearing filters restores the unfiltered list

- **WHEN** the user clears the active filters
- **THEN** the app requests the list with no filter parameters and shows the full company-scoped list

#### Scenario: Option-backed filters are gated by their read permission

- **WHEN** a user without `DEPARTMENT_VIEW` (or `MASTER_VIEW`, or `DOC_CREATE`) opens the documents list
- **THEN** the department (respectively vendor, or document-type) filter is not shown, while the
  status, date-range, document-number, and amount filters remain available
