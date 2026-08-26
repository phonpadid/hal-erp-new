# Web UI Quality Specification

## Purpose
Baseline quality bar for every routed web view: it must render without errors,
handle loading/empty/error states, format money via currency `decimal_places`, gate
controls by permission code, resolve all visible text through i18n, and pass type
checking before the build ships.

## Requirements

### Requirement: Every routed page renders without errors

Every view reachable from the router SHALL mount and render without throwing or emitting
console errors, for an authenticated user holding the route's required permission code.

#### Scenario: Page mounts cleanly
- **WHEN** an authenticated, permitted user navigates to any route registered in the
  router
- **THEN** the view mounts, renders its top-level layout, and no uncaught exception or
  Vue render-time console error occurs

#### Scenario: Smoke-render test guards each view
- **WHEN** the test suite runs
- **THEN** each routed view has a smoke test that mounts it with mocked store, router,
  and i18n and asserts it renders without throwing

### Requirement: Pages handle loading, empty, and error states

Every view that loads data asynchronously SHALL present a distinct loading indicator
while fetching, a meaningful empty state when a result set is empty, and an error state
with a retry affordance when a request fails.

#### Scenario: Loading state while fetching
- **WHEN** a view's data request is in flight
- **THEN** the view shows a loading indicator and does not render an empty/blank table as
  if the request had completed

#### Scenario: Empty state shows a title and message
- **WHEN** a data request succeeds but returns no rows
- **THEN** the view renders the shared `EmptyState` component with BOTH its required
  `title` and an explanatory `message`, never a blank heading

#### Scenario: Error state offers retry
- **WHEN** a view's data request fails
- **THEN** the view renders an error state describing the failure and a control that
  re-issues the request

### Requirement: Money is formatted via currency decimal_places

Every view that displays a monetary amount SHALL format it using the currency's
`decimal_places` and SHALL NOT carry the amount as a JavaScript `number`.

#### Scenario: Amount rendered with correct precision
- **WHEN** a view displays a budget, document, quota, or payment amount
- **THEN** the amount is formatted to the currency's `decimal_places` and the underlying
  value is a string or Decimal, never a JS `number`

### Requirement: UI is gated by permission code

Every view and the actions within it SHALL show, hide, enable, or disable controls based
on permission codes from the active-company context, mirroring the server's scope rules.

#### Scenario: Action hidden without permission
- **WHEN** the active user lacks the permission code required for an action on a page
- **THEN** the control for that action is hidden or disabled, matching the route guard and
  the server's authorization

### Requirement: All visible text resolves an i18n key

Every user-facing string in a view SHALL come from an i18n key that resolves in all
supported locales, with no raw key or missing-translation placeholder shown.

#### Scenario: No unresolved i18n keys
- **WHEN** a view renders in any supported locale
- **THEN** every label, header, empty-state, and message displays translated text, not the
  raw key path or a missing-key fallback

### Requirement: Type checking gates the build

The web build SHALL fail when any view has a TypeScript error, so prop-contract
violations cannot ship.

#### Scenario: Type error blocks the build
- **WHEN** `vue-tsc -b` reports an error in any view or component
- **THEN** the build fails and the change is not shippable until the error is resolved

### Requirement: A passing web test run exits clean

The web test run SHALL exit zero whenever every test passes, so that the exit status is a usable
gate. An error raised outside an assertion — an unhandled rejection, a render error after a test
has completed — SHALL be treated as a failure of the suite, not as noise, and SHALL be repaired
rather than tolerated.

#### Scenario: Every test passes

- **WHEN** the web test script is run and no test fails
- **THEN** the run reports no errors and the process exits zero

### Requirement: A module mock covers the surface the component calls

A spec that replaces an API module SHALL provide every member the component under test calls, and
SHOULD build the replacement from the real module so that a member added later resolves to its
real implementation instead of `undefined`. A spec SHALL unmount what it mounts rather than
clearing the document while a mounted component is still live.

#### Scenario: The view calls an API member the spec did not name

- **GIVEN** a view whose `onMounted` calls an optional member of an API module
- **WHEN** a spec mounts that view behind a replaced module
- **THEN** the call resolves instead of throwing, and no unhandled rejection escapes the test

#### Scenario: A spec mounts a component that teleports a dialog

- **WHEN** a spec mounts such a component and the next test begins
- **THEN** the previous wrapper has been unmounted, taking its teleported nodes with it, and no
  component patches into a tree whose parent has been removed

### Requirement: The application chrome fits the viewport at every width

The topbar SHALL remain legible and complete at every supported viewport width. No part of it SHALL
be clipped by the viewport edge, no element SHALL be drawn over another, and the brand SHALL NOT
wrap onto a second line.

Where the bar has more controls than horizontal room, the controls that express a preference —
language, theme, and appearance — SHALL fold into the bar's existing overflow menu, and the controls
that state the user's working context — the active company and pending notifications — SHALL remain
directly visible at every width. A user must be able to see which company they are acting in, and to
reach sign-out, without knowing that anything has been collapsed.

The bar's height SHALL NOT depend on the viewport width, because the page layout offsets against it.

#### Scenario: A narrow viewport clips nothing

- **GIVEN** a viewport narrow enough that the topbar's controls exceed its width
- **WHEN** the topbar renders
- **THEN** no control extends past the viewport edge and the brand occupies a single line

#### Scenario: Context controls survive the fold

- **GIVEN** a viewport narrow enough for the bar to collapse its optional controls
- **WHEN** the topbar renders
- **THEN** the active-company control and the notification indicator are still directly visible, and
  sign-out remains reachable through the overflow menu

#### Scenario: The preference controls are still reachable

- **GIVEN** a collapsed topbar
- **WHEN** the overflow menu is opened
- **THEN** the language, theme and appearance controls are present and usable

### Requirement: A Global Affordance Never Covers A Screen's Primary Action

A global floating affordance SHALL NOT obscure a screen's own primary action, nor the message a
screen shows in place of content. Such an affordance — a support contact button, for example —
belongs to the application rather than to any one screen. Where a page presents a
sticky action area and a global floating affordance occupies the same region, the page's action area
SHALL paint above it and SHALL be opaque enough that the affordance does not show through.

Where a page presents an empty state or an error state and a global floating affordance occupies the
same region, that state's title and message SHALL remain fully legible. A reader who has been given
no rows must still be able to read why.

A global affordance SHALL be presented only within the authenticated application. It SHALL NOT
appear on the sign-in screen or on any other route reachable before authentication, because it
offers a channel to someone the system has not yet identified.

#### Scenario: The wizard's action bar is clickable where the two overlap

- **GIVEN** a screen with a sticky action area in the same corner as a global floating affordance
- **WHEN** the user clicks the screen's primary action at the point where the two coincide
- **THEN** the screen's action receives the click

#### Scenario: An empty state is legible under the affordance

- **GIVEN** a screen showing an empty state in the same region as a global floating affordance
- **WHEN** the screen renders at any supported viewport width
- **THEN** the empty state's title and message are fully visible and are not covered by the
  affordance

#### Scenario: Nothing floats over the sign-in screen

- **WHEN** an unauthenticated visitor loads the sign-in screen
- **THEN** no global floating affordance is rendered

### Requirement: A Control Whose Options Failed To Load Says So

A selection control SHALL distinguish "there is nothing to choose" from "the list of choices could
not be read". A control whose option request failed SHALL present an error affordance naming that
the options could not be loaded, and SHALL NOT fall back to the component's generic empty text,
which a reader takes as a statement about the data.

Where a control's options are withheld because the user lacks the permission to read them, the
control SHALL NOT be rendered at all — an unexplained empty control invites the reader to conclude
the system is broken.

An option request SHALL NOT be reduced to an empty list by the caller. Where a store or view today
writes `.catch(() => [])`, the failure SHALL be retained and surfaced by the control that depends
on it.

#### Scenario: A failed option read is not shown as an empty list

- **GIVEN** a selection control whose option request fails
- **WHEN** the user opens the control
- **THEN** it shows that the options could not be loaded, and does not show the component's default
  empty-options text

#### Scenario: An option list the user may not read is not offered

- **GIVEN** a user who lacks the permission required to read a control's option list
- **WHEN** the view renders
- **THEN** the control is absent rather than present and empty

#### Scenario: An empty option list that really is empty reads as empty

- **GIVEN** a selection control whose option request succeeds and returns no rows
- **WHEN** the user opens the control
- **THEN** it states that there is nothing to choose, distinct from the failure text

### Requirement: A Table Wider Than The Viewport Keeps Its Columns Reachable

A data table whose columns exceed the viewport width SHALL keep every column reachable and SHALL
make it evident that columns exist beyond the visible edge. Horizontal scrolling alone is not
sufficient: at 375px the documents list presents two of its eight columns with no indication that
status, amount, date, and next approver exist, so a reader concludes the table holds only what they
can see.

A table SHALL NOT be the only route to a value a reader needs in order to triage. Where the
viewport cannot carry the table's columns, the view SHALL present the row's identifying and
decision-bearing fields in a layout that fits the viewport.

#### Scenario: A narrow viewport does not hide columns without saying so

- **GIVEN** a viewport narrower than a table's natural column width
- **WHEN** the table renders
- **THEN** every column remains reachable and the view indicates that more columns exist than are
  visible

#### Scenario: A row stays triageable at the narrowest supported width

- **GIVEN** a list view at 375px
- **WHEN** a row renders
- **THEN** the fields a reader needs to triage that row are visible without horizontal scrolling

### Requirement: An Empty State Is Centred On The Viewport, Not On Its Container

An empty state SHALL be positioned so that it is visible without horizontal scrolling, whatever the
width of the region that contains it. An empty state rendered inside a horizontally scrollable table
SHALL centre on the visible area rather than on the table's natural width; centring on the container
places the message off-screen exactly when the table is too wide, which is when the reader most
needs it.

#### Scenario: An empty state inside a wide scrollable table stays on screen

- **GIVEN** a table whose natural width exceeds the viewport and whose result set is empty
- **WHEN** the empty state renders
- **THEN** its title and message are visible without scrolling horizontally

### Requirement: A Failed Request Is Never Discarded Silently

A view SHALL NOT discard a failed request without a trace the reader can act on. Where a request is
genuinely optional — a section that simply does not apply to this record — the view SHALL omit the
request rather than issue it and swallow the failure, so that a real failure of that request remains
distinguishable from a routine absence.

A rendering failure inside a view — a chart that cannot acquire a drawing context, for example —
SHALL surface as an error state in the region that failed, not as an empty region indistinguishable
from a region with no data.

#### Scenario: An inapplicable section is not requested

- **GIVEN** a document with no payment handoff
- **WHEN** the detail view renders
- **THEN** it does not request that document's payment slips, and no 404 is raised for it

#### Scenario: A failed optional request is visible where it belongs

- **GIVEN** a section whose request fails for a reason other than the record not having that section
- **WHEN** the view renders
- **THEN** that section shows an error state, not an empty state

#### Scenario: A chart that cannot render says so

- **GIVEN** a report whose chart fails to initialise
- **WHEN** the report renders
- **THEN** the chart region shows an error state rather than an empty card

### Requirement: A List Control That Appears To Filter Filters The Whole List

A control a list screen offers for narrowing that list SHALL narrow the set the list is drawn from,
not the page that happens to be loaded, and SHALL NOT be rendered at all where nothing is wired to
it.

A list rendered from a server page holds a fraction of its data. A control bound to a client-side
filter over that fraction reports "no results" for a term that matches a hundred rows on the next
page, and a reader has no way to tell that from a term that matches nothing. Where the whole set IS
on the client — a table whose total is the length of its own array — client-side filtering is the
correct implementation and the requirement is satisfied by it.

A control rendered but wired to nothing is the worse case, because it costs the reader the attempt
before it costs them the answer. Fourteen list screens shipped one: each bound PrimeVue's
client-side `filters` to a table in `lazy` mode, where the binding is ignored outright. A shared
table component SHALL fail loudly, in development, when given filter bindings it will not apply,
so the next screen to make this mistake finds out at the component boundary rather than in a
browser.

#### Scenario: A term reaches rows beyond the loaded page

- **GIVEN** a server-paged list whose matching row is not on the page currently shown
- **WHEN** the reader searches for it
- **THEN** it is listed

#### Scenario: A term matching nothing says so

- **WHEN** the reader searches a server-paged list for a term no row matches
- **THEN** the list shows an empty result for that search, distinguishable from the unfiltered list

#### Scenario: A fully-loaded list may filter on the client

- **GIVEN** a list whose every row is already loaded
- **WHEN** the reader searches it
- **THEN** every matching row is shown, whether the filtering happened on the client or the server

#### Scenario: A view that shows the same data two ways offers the box only where it works

- **GIVEN** a screen whose grouping control switches between a server-paged table and a fully-loaded
  tree fed by its own request
- **WHEN** the reader switches to the view the term does not narrow
- **THEN** the search field is not rendered for that view

#### Scenario: An unwired filter binding is refused at the boundary

- **GIVEN** a shared table component running in a mode where client-side filter bindings are ignored
- **WHEN** a caller passes such bindings
- **THEN** development builds report it, naming the component and what to do instead
