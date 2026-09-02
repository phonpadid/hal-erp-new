## MODIFIED Requirements

### Requirement: Document List Filtering

The documents list page SHALL provide a filter bar that drives server-side filtering of the
company-scoped list. The filters SHALL include document status (multi-select), a created-date
range, a document-number search, and an amount range, which are available to any `DOC_VIEW` user.

The filter bar SHALL additionally offer document type, department, and vendor filters. Each
option-backed filter SHALL be shown only when the user holds the read permission that governs its
option list, mirroring the server's scope rules: `DEPARTMENT_VIEW` for department, `MASTER_VIEW`
for vendor, and `DOC_VIEW` for document type. The document-type filter SHALL be gated by `DOC_VIEW`
rather than `DOC_CREATE`, and its option list SHALL be the document types that occur within the
list the user can see, not the types the user is entitled to create. A reader filtering documents
that other people raised is asking which types are present; answering with the types they may
author leaves a reviewer who creates nothing with an empty filter over a populated list.

An option-backed filter SHALL distinguish an option list that is empty from one that failed to
load, and SHALL NOT present a failed read as an empty list.

Changing any filter SHALL request the
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

- **WHEN** a user without `DEPARTMENT_VIEW` (or `MASTER_VIEW`) opens the documents list
- **THEN** the department (respectively vendor) filter is not shown, while the status, date-range,
  document-number, amount, and document-type filters remain available

#### Scenario: A reviewer who creates nothing can still filter by type

- **GIVEN** a `DOC_VIEW` user who holds no `DOC_CREATE` for any document type in this company
- **WHEN** they open the documents list and open the document-type filter
- **THEN** the filter is present and offers every type occurring in the list they can see

#### Scenario: The type filter offers the types present, not the types creatable

- **GIVEN** a user entitled to create one document type, viewing a list containing three types
- **WHEN** they open the document-type filter
- **THEN** it offers the three types present in the list

#### Scenario: A type-filter read failure is not shown as an empty list

- **GIVEN** a `DOC_VIEW` user whose document-type option request fails
- **WHEN** they open the document-type filter
- **THEN** it states that the options could not be loaded rather than that there are none
