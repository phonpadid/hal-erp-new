## ADDED Requirements

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

## MODIFIED Requirements

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
