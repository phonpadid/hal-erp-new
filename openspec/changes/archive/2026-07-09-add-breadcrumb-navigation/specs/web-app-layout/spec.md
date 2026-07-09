## ADDED Requirements

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
