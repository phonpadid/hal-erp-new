## MODIFIED Requirements

### Requirement: Permission-Gated Navigation

The sidebar menu SHALL show only the navigation entries whose permission code the active company
grants (UX only; the server still enforces). The menu replaces the previous header nav. The
entries SHALL be organised into labelled, ordered sections (separated groups) rather than a single
flat list, and a section SHALL be omitted entirely when the user can see none of its entries.

#### Scenario: Entry hidden without permission

- **WHEN** a signed-in user lacks a navigation entry's permission code
- **THEN** that entry is not shown in the sidebar

#### Scenario: Navigation is grouped into sections

- **WHEN** a signed-in user opens the sidebar
- **THEN** the entries are presented under labelled sections (e.g. workspace, administration) separated from one another rather than as one flat list

#### Scenario: A fully-hidden section is omitted

- **WHEN** a user can see none of the entries in a section
- **THEN** that section's heading is not shown

### Requirement: Consistent Page Layout

Every authenticated in-app page SHALL adopt the shared sakai-style page layout — a consistent page
header (title and optional actions) and card-based content containers — using PrimeUI theme tokens
(no hardcoded colors) so the page renders correctly in both light and dark mode. The shared layout
SHALL additionally provide, from a common page-component kit, a list-page toolbar and explicit
loading / empty / error states for content regions, so pages of the same type look and behave
consistently rather than each re-inventing these affordances. List pages SHALL present their
records through a toolbar plus a data region with explicit states; detail pages SHALL present a
status-aware header plus titled card sections.

#### Scenario: Pages share the same header and card structure

- **WHEN** a signed-in user navigates between in-app pages
- **THEN** each page presents the same page-header and card layout convention

#### Scenario: Pages render correctly in dark mode

- **WHEN** the user enables dark mode from the configurator
- **THEN** every page's surfaces, text, and borders adapt via theme tokens with no hardcoded colors

#### Scenario: Same-type pages share the same affordances

- **WHEN** a signed-in user moves between two list pages (e.g. budgets and documents)
- **THEN** both present the same toolbar and the same loading / empty / error treatment from the shared kit

## ADDED Requirements

### Requirement: List Page Toolbar

A list page SHALL present its records beneath a shared toolbar that provides a global search
field, a region for page-specific filters, a region for the page's primary action(s), and a
region for bulk actions on selected rows. The bulk-action region SHALL appear only when one or
more rows are selected, and every primary and bulk action SHALL be gated by the same permission
code that governs the equivalent single-record action (UX only; the server stays authoritative).
The toolbar SHALL use PrimeUI theme tokens so it renders correctly in light and dark mode, and all
of its labels and placeholders SHALL come from i18n with en/la parity.

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

### Requirement: Content Region States

A content region that loads data (a list table or a detail section) SHALL render an explicit
state for each of loading, empty, and error, drawn from the shared page-component kit, rather than
relying on an implicit spinner or bare text. While data is loading and none is yet available, the
region SHALL show a skeleton placeholder sized to the expected content. When loading succeeds with
no records, the region SHALL show an empty state (icon, title, message, and an optional call to
action). When loading fails, the region SHALL show an error state with the failure message and a
retry affordance. All state text SHALL come from i18n with en/la parity, and all states SHALL use
PrimeUI theme tokens so they render correctly in light and dark mode.

#### Scenario: Loading shows a skeleton

- **WHEN** a list page is fetching its first page of data
- **THEN** a skeleton placeholder is shown in place of the table rows

#### Scenario: Empty result shows an empty state

- **WHEN** a list loads successfully but returns no records
- **THEN** an empty state with a title and message (and an optional action) is shown instead of a blank table

#### Scenario: Failure shows an error state with retry

- **WHEN** a content region fails to load its data
- **THEN** an error state shows the failure message and offers a retry that re-requests the data

### Requirement: Detail Page Layout

A detail page SHALL present a header that shows the record's title/identifier together with its
status (rendered as a status tag), and SHALL group the record's content into titled card sections
rather than a stack of unlabeled cards. The status tag and section surfaces SHALL use PrimeUI
theme tokens so they render correctly in light and dark mode, and all labels SHALL come from i18n
with en/la parity.

#### Scenario: Detail header shows identity and status together

- **WHEN** a signed-in user opens a record's detail page
- **THEN** the header shows the record's title/identifier and a status tag

#### Scenario: Detail content is grouped into titled sections

- **WHEN** a detail page renders multiple groups of information
- **THEN** each group appears in its own titled card section

### Requirement: Input Controls Matched to Data Shape

A form field SHALL be rendered with the input control appropriate to its data shape rather than a
single generic text input. Multi-line / long text SHALL use a multi-line text area (auto-growing),
and rich text SHALL use a rich-text editor. For configuration-driven (dynamic) form fields, the
rendered control SHALL be derived from the field's type definition (configuration over code), and
the value submitted SHALL remain compatible with the existing document payload.

#### Scenario: Long text uses a text area

- **WHEN** a form presents a field intended for long or multi-line text
- **THEN** the field is rendered as an auto-growing text area rather than a single-line input

#### Scenario: Rich text uses an editor

- **WHEN** a form presents a field intended for rich (formatted) text
- **THEN** the field is rendered with a rich-text editor

#### Scenario: Dynamic field control follows its type

- **WHEN** a configuration-driven form renders a field
- **THEN** the control shown is determined by that field's type definition, not hardcoded per field

### Requirement: Stepped Long Forms

A form with multiple distinct sections SHALL be presented as an ordered set of steps (a wizard)
with a visible progress indicator, instead of a single long scrolling form. Each step SHALL
validate its own required fields before the user may advance, and the final submission SHALL
produce the same request as the equivalent single-page form.

#### Scenario: A multi-section form is presented as steps

- **WHEN** a user opens a form that has several distinct sections
- **THEN** the sections are presented as ordered steps with a progress indicator

#### Scenario: Advancing requires the current step to be valid

- **WHEN** a user tries to advance from a step whose required fields are incomplete
- **THEN** advancing is blocked until those fields are valid

### Requirement: Event History as Timeline

A record's sequential event history (such as its approval history) SHALL be presented as a
vertical timeline with a status-indicating marker, actor, timestamp, and any remark per event,
rather than as a plain table. The timeline SHALL use PrimeUI theme tokens so it renders correctly
in light and dark mode, and its labels SHALL come from i18n with en/la parity.

#### Scenario: Approval history renders as a timeline

- **WHEN** a user opens a document's detail page that has approval history
- **THEN** the history is shown as a vertical timeline with a status marker, actor, time, and remark per event

#### Scenario: Empty history shows an empty state

- **WHEN** a record has no recorded events yet
- **THEN** the timeline region shows an empty state instead of an empty table
