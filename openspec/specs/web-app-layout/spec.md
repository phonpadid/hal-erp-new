# web-app-layout

## Purpose
The Vue application shell for authenticated users: a topbar/sidebar/menu/configurator/footer
layout that wraps every in-app route. The sidebar exposes permission-gated ERP navigation for
the active company (UX-only; the server stays authoritative), and a configurator lets the user
switch theme (preset, primary colour, surface, dark mode, menu mode) and locale with the change
applied immediately. Per-user settings are loaded from the user-preferences backend on mount /
session restore and auto-saved (debounced, sending only changed fields), falling back to defaults
when the settings API is unavailable.

## Requirements

### Requirement: Application Shell

The web app SHALL render authenticated pages inside an application shell with a topbar (logo, menu
toggle, locale switch, dark-mode toggle, theme configurator, profile/logout), a collapsible
sidebar menu, and a content area. The active-company switch and the notification bell SHALL be
present in the topbar.

#### Scenario: Authenticated pages render in the shell

- **WHEN** a signed-in user opens any in-app route
- **THEN** the page renders inside the topbar + sidebar shell

#### Scenario: Logout from the topbar

- **WHEN** the user activates logout in the topbar
- **THEN** the session ends and they are returned to login

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

### Requirement: Theme and Locale Switching

The web app SHALL let the user change the theme (preset, primary colour, surface, dark mode, menu
mode) via the configurator and switch the locale, applying the change immediately.

#### Scenario: Changing a colour applies immediately

- **WHEN** the user picks a different primary colour in the configurator
- **THEN** the UI updates to that colour without a reload

### Requirement: Per-User Settings Sync

The web app SHALL load the signed-in user's saved settings on session restore and apply the theme
and locale, and SHALL auto-save changes (debounced, sending only changed fields). If the settings
API is unavailable, the app SHALL fall back to defaults without blocking use.

#### Scenario: Saved settings apply on next sign-in

- **WHEN** a user who previously chose a theme signs in again
- **THEN** that theme and locale are applied on load

#### Scenario: A change is persisted

- **WHEN** the user changes a setting
- **THEN** the change is saved for their account shortly after

### Requirement: Consistent Page Layout

Every authenticated in-app page SHALL adopt the shared sakai-style page layout — a consistent page
header (title and optional actions) and panel-based content containers — using PrimeUI theme tokens
(no hardcoded colors) so the page renders correctly in both light and dark mode. The content region
SHALL be sized and positioned by the shell exactly once (in `layout-main` / a shared page
container): in-app pages SHALL render full-width within the shell's container padding and SHALL NOT
set their own page width (no per-view `max-w-*` + `mx-auto` wrappers), so the horizontal gutters are
identical on every route. Section grouping SHALL be expressed through shared PrimeVue panel
components (e.g. `Card`, `Panel`, `Fieldset`, `Divider`, `Accordion`, `ScrollPanel`, `Splitter`)
rather than bare text or ad-hoc styled `div`s. The shared layout SHALL additionally provide, from a
common page-component kit, a list-page toolbar and explicit loading / empty / error states for
content regions, so pages of the same type look and behave consistently rather than each
re-inventing these affordances. List pages SHALL present their records through a toolbar plus a data
region with explicit states; detail pages SHALL present a status-aware header plus titled panel
sections.

#### Scenario: Pages share the same header and content structure

- **WHEN** a signed-in user navigates between in-app pages
- **THEN** each page presents the same page-header convention and panel-based content containers

#### Scenario: Every in-app page uses the same full-width content region

- **WHEN** a signed-in user navigates between any two in-app routes (e.g. the dashboard and a list)
- **THEN** both render full-width with identical horizontal gutters, because no page sets its own
  width and the content region is sized once by the shell

#### Scenario: Pages render correctly in dark mode

- **WHEN** the user enables dark mode from the configurator
- **THEN** every page's surfaces, text, and borders adapt via theme tokens with no hardcoded colors

#### Scenario: Same-type pages share the same affordances

- **WHEN** a signed-in user moves between two list pages (e.g. budgets and documents)
- **THEN** both present the same toolbar and the same loading / empty / error treatment from the shared kit

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
status (rendered as a status tag), and SHALL group the record's content into titled panel sections
(shared PrimeVue panel components) rather than a stack of unlabeled cards. The status tag and section surfaces SHALL use PrimeUI
theme tokens so they render correctly in light and dark mode, and all labels SHALL come from i18n
with en/la parity.

#### Scenario: Detail header shows identity and status together

- **WHEN** a signed-in user opens a record's detail page
- **THEN** the header shows the record's title/identifier and a status tag

#### Scenario: Detail content is grouped into titled sections

- **WHEN** a detail page renders multiple groups of information
- **THEN** each group appears in its own titled panel section drawn from the shared kit

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

### Requirement: Home Dashboard

The web app SHALL provide a home Dashboard at the application root (`/`) presenting summary widgets
(stat cards and charts) for the active company. Each widget SHALL be gated by the permission code of
its underlying feature (UX only; the server stays authoritative), and the dashboard SHALL remain
valid when a user has permission for no widgets. Widgets SHALL load independently so one failing or
slow widget does not block the rest of the dashboard.

#### Scenario: Root route opens the dashboard

- **WHEN** a signed-in user opens the application root
- **THEN** the Dashboard is shown as the landing page

#### Scenario: Widget hidden without permission

- **WHEN** a user lacks the permission code for a dashboard widget
- **THEN** that widget is not shown, and the rest of the dashboard still renders

#### Scenario: A widget loads independently

- **WHEN** one dashboard widget's data is slow or fails to load
- **THEN** the other widgets still render with their own loading, empty, or error state

### Requirement: Action Feedback and Confirmation

Every user-initiated action (a create / update / submit / approve / cancel / delete and
the like) SHALL give explicit feedback through a shared feedback seam: on success a
success **toast**, and on failure an error **toast** carrying the server's message. Errors
SHALL NOT be shown in a modal dialog. A **confirmation dialog** SHALL be used only to
confirm a destructive or otherwise serious action *before* it runs (e.g. cancelling or
rejecting a document, closing a fiscal year, removing a holiday, revoking access or a role
assignment, cancelling a delegation); the action SHALL proceed only if the user accepts.
This action feedback is distinct from, and SHALL NOT replace, the content-region
loading / empty / error states used for page-load (GET) failures, which remain inline with
their retry affordance. All toast and dialog text SHALL come from i18n with en/la parity and
SHALL use PrimeUI theme tokens so it renders correctly in light and dark mode.

#### Scenario: Successful action shows a success toast

- **WHEN** a user completes an action that succeeds (e.g. creates a record or submits a document)
- **THEN** a success toast is shown confirming the outcome

#### Scenario: Failed action shows an error toast

- **WHEN** a user-initiated action fails (any status)
- **THEN** an error toast is shown with the server's message, and no modal dialog is used to display it

#### Scenario: Destructive action is confirmed first

- **WHEN** a user triggers a destructive action (e.g. cancel/reject a document, close a fiscal year, revoke access)
- **THEN** a confirmation dialog appears, and the action runs only if the user accepts and is abandoned if they cancel

#### Scenario: Page-load failure still uses the inline error state

- **WHEN** a page's initial data request (GET) fails
- **THEN** the inline content-region error state with retry is shown (not a toast or dialog)

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

### Requirement: Breadcrumb Navigation

Every authenticated in-app page SHALL display a breadcrumb trail, rendered once by the application
shell (not re-implemented per view), showing the path from the home Dashboard through the page's
navigation section to the current page. The breadcrumb SHALL be built with the shared PrimeVue
`Breadcrumb` component and its trail SHALL be derived from the active route's metadata together
with the permission-gated navigation model, so its labels stay consistent with the sidebar. The
home item SHALL link to the Dashboard (`/`); ancestor page crumbs SHALL be links; the current page
SHALL be the final, non-link crumb. A crumb SHALL link to its target only when the active company
grants that target's permission code (UX only; the server stays authoritative); a crumb whose
target is not permitted SHALL render as plain text rather than a link. Detail and other
dynamic pages SHALL be able to contribute their own trailing crumb(s) (e.g. a document number or a
record name), and such contributions SHALL be cleared on navigation so crumbs do not leak between
pages. All breadcrumb labels SHALL come from i18n with en/la parity, and the breadcrumb SHALL use
PrimeUI theme tokens so it renders correctly in both light and dark mode.

#### Scenario: Every in-app page shows a breadcrumb from the shell

- **WHEN** a signed-in user opens any in-app route below the dashboard (e.g. a list, detail, form, or report page)
- **THEN** a breadcrumb trail is shown, rendered by the shell, starting from the home Dashboard and ending at the current page

#### Scenario: Trail reflects the navigation section and page

- **WHEN** a signed-in user opens a page that belongs to a navigation section (e.g. Documents under the workspace section)
- **THEN** the breadcrumb shows Home → that section → that page, using the same labels the sidebar shows

#### Scenario: Current page is the non-link leaf and ancestors are links

- **WHEN** a breadcrumb is shown for a page
- **THEN** the home and ancestor crumbs are links (home to the dashboard, ancestors to their pages) and the current page is plain, non-link text

#### Scenario: A crumb the user cannot access is not a link

- **WHEN** a breadcrumb includes an ancestor crumb whose target permission code the active company does not grant
- **THEN** that crumb is rendered as plain text rather than a navigable link

#### Scenario: A detail page contributes a dynamic leaf crumb

- **WHEN** a signed-in user opens a record's detail page (e.g. a document with a document number)
- **THEN** the breadcrumb's final crumb is that record's identifier, appended after the derived section/page trail

#### Scenario: Dynamic crumbs do not leak across pages

- **WHEN** a user navigates from a detail page that contributed a dynamic crumb to a different page
- **THEN** the previous page's dynamic crumb is cleared and the new page shows only its own trail

#### Scenario: Breadcrumb renders correctly in dark mode

- **WHEN** the user enables dark mode from the configurator
- **THEN** the breadcrumb's text, links, and separators adapt via theme tokens with no hardcoded colors
