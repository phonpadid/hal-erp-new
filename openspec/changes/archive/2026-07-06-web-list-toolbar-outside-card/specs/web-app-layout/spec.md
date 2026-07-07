## MODIFIED Requirements

### Requirement: List Page Toolbar

A list page SHALL present its records beneath a shared toolbar that provides a global search
field, a region for page-specific filters, a region for the page's primary action(s), and a
region for bulk actions on selected rows. The bulk-action region SHALL appear only when one or
more rows are selected, and every primary and bulk action SHALL be gated by the same permission
code that governs the equivalent single-record action (UX only; the server stays authoritative).
The toolbar SHALL use PrimeUI theme tokens so it renders correctly in light and dark mode, and all
of its labels and placeholders SHALL come from i18n with en/la parity.

A list page that presents a single data table SHALL position its toolbar as a page-level control
**outside and above** the card (or panel) that contains that table — the toolbar SHALL NOT be nested
inside that card. Such a page SHALL follow the same top-to-bottom structure: the page header, then
the toolbar, then the content-region error state, then the data-region card containing an optional
hint line followed by the shared data table. Because the toolbar sits above the error state, its
search and filter controls SHALL remain visible even when the data request has failed.

A page that presents multiple data tables under tabs (a distinct per-tab search, filter, and action
context per tab) MAY place a toolbar within each tab region rather than a single toolbar above the
card, since one page-level toolbar cannot serve the differing contexts of separate tabs.

#### Scenario: Global search narrows the list

- **WHEN** a user types into the toolbar's search field on a list page
- **THEN** the list filters to matching rows without a full page reload

#### Scenario: Bulk actions appear only with a selection

- **GIVEN** a list page that supports a bulk action
- **WHEN** no rows are selected
- **THEN** the bulk-action region is not shown, and it appears once one or more rows are selected

#### Scenario: Toolbar actions respect permission codes

- **GIVEN** a user whose active company lacks the permission code for a list's create action
- **WHEN** the list page renders
- **THEN** that action is not shown in the toolbar

#### Scenario: Toolbar sits outside the data card

- **WHEN** a single-table list page renders its records
- **THEN** the toolbar appears above the card that wraps the data table, as a sibling of that card
  rather than a child of it, in the order page header → toolbar → error state → data card

#### Scenario: Tabbed multi-table page keeps a per-tab toolbar

- **WHEN** a page presents multiple data tables under tabs, each with its own search, filters, and
  actions
- **THEN** each tab MAY carry its own toolbar within the tab region, because a single page-level
  toolbar cannot serve the differing per-tab contexts

#### Scenario: Same structure across list pages

- **WHEN** a signed-in user moves between two different list pages
- **THEN** both present the toolbar in the same position relative to the header and the data card, so
  the filter bar reads as a page control on every list page
