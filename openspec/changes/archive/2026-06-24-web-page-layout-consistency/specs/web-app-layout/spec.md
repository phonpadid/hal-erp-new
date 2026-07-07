## MODIFIED Requirements

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

### Requirement: Detail Page Layout

A detail page SHALL present a header that shows the record's title/identifier together with its
status (rendered as a status tag), and SHALL group the record's content into titled panel sections
(shared PrimeVue panel components) rather than a stack of unlabeled cards or bare text. The status
tag and section surfaces SHALL use PrimeUI theme tokens so they render correctly in light and dark
mode, and all labels SHALL come from i18n with en/la parity.

#### Scenario: Detail header shows identity and status together

- **WHEN** a signed-in user opens a record's detail page
- **THEN** the header shows the record's title/identifier and a status tag

#### Scenario: Detail content is grouped into titled sections

- **WHEN** a detail page renders multiple groups of information
- **THEN** each group appears in its own titled panel section drawn from the shared kit
