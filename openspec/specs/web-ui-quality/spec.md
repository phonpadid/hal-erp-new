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

A global floating affordance SHALL NOT obscure a screen's own primary action. Such an affordance —
a support contact button, for example — belongs to the application rather than to any one screen. Where a page presents a
sticky action area and a global floating affordance occupies the same region, the page's action area
SHALL paint above it and SHALL be opaque enough that the affordance does not show through.

A global affordance SHALL be presented only within the authenticated application. It SHALL NOT
appear on the sign-in screen or on any other route reachable before authentication, because it
offers a channel to someone the system has not yet identified.

#### Scenario: The wizard's action bar is clickable where the two overlap

- **GIVEN** a screen with a sticky action area in the same corner as a global floating affordance
- **WHEN** the user clicks the screen's primary action at the point where the two coincide
- **THEN** the screen's action receives the click

#### Scenario: Nothing floats over the sign-in screen

- **WHEN** an unauthenticated visitor loads the sign-in screen
- **THEN** no global floating affordance is rendered
