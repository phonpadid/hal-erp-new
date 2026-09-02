# web-ui-quality

## ADDED Requirements

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
