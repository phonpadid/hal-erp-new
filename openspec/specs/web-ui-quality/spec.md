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
