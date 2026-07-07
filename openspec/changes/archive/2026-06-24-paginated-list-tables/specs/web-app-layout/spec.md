## ADDED Requirements

### Requirement: Scrollable Paginated Data Table

List pages SHALL present their records through a single shared data-table component rather than
each view re-wiring a raw table. The component SHALL be vertically **scrollable** with a fixed
scroll height (default `500px`, overridable) and SHALL page against the server in **lazy** mode:
it binds the server's `total` to the paginator and emits the requested `{ page, limit }` so the
caller refetches that window (the client SHALL NOT page an already-complete client-side array for
server-paginated lists). While a page is loading it SHALL show a loading indicator
(`ProgressSpinner`) in place of rows, and its paginator SHALL include a **refresh** control that
re-requests the current page (with a busy indicator while loading). The table SHALL render a
leading row-number (`#`) column. Column definitions SHALL be supplied by the caller. All chrome
labels SHALL come from i18n with en/la parity and use PrimeUI theme tokens so it renders correctly
in light and dark mode.

#### Scenario: List pages share the scrollable paginated table

- **WHEN** a signed-in user opens any list page
- **THEN** records are shown in the shared table, scrollable at the fixed height, with a paginator

#### Scenario: Paging requests the next window from the server

- **WHEN** the user moves to another page or changes the page size
- **THEN** the component emits the new `{ page, limit }` and the caller fetches that window, with
  the paginator total reflecting the server's `total`

#### Scenario: Loading and refresh affordances

- **WHEN** a page is being fetched
- **THEN** a progress spinner replaces the rows, and the paginator's refresh control re-requests the
  current page and shows a busy indicator while it loads

#### Scenario: Row numbering

- **WHEN** a page of rows is shown
- **THEN** a leading `#` column numbers the rows
