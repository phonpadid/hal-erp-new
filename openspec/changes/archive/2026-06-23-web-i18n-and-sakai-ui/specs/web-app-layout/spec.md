## ADDED Requirements

### Requirement: Consistent Page Layout

Every authenticated in-app page SHALL adopt the shared sakai-style page layout — a consistent page
header (title and optional actions) and card-based content containers — using PrimeUI theme tokens
(no hardcoded colors) so the page renders correctly in both light and dark mode.

#### Scenario: Pages share the same header and card structure

- **WHEN** a signed-in user navigates between in-app pages
- **THEN** each page presents the same page-header and card layout convention

#### Scenario: Pages render correctly in dark mode

- **WHEN** the user enables dark mode from the configurator
- **THEN** every page's surfaces, text, and borders adapt via theme tokens with no hardcoded colors

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
