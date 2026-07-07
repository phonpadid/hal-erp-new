## ADDED Requirements

### Requirement: Create Wizard Document Type Selection

The Create Document wizard's first step SHALL let the user choose the document type from a set
of selectable cards — each showing the type's icon, name, and a short description — rather than a
bare dropdown. Exactly one card is selectable at a time, the selection SHALL be operable by
keyboard (focusable and activatable with Enter/Space) and expose its selected state to assistive
technology. When the chosen type carries money (category PROCUREMENT or FINANCE) the currency
picker SHALL remain available, and when the type is configured `requires_vendor` the vendor
picker SHALL remain available, both alongside the type selection. In edit mode the type is fixed
and the cards SHALL render in a read-only, non-interactive form. When the type list is still
loading, a skeleton placeholder SHALL be shown in place of the cards.

#### Scenario: Type is chosen from cards
- **WHEN** a user on the first step clicks or keyboard-activates a document-type card
- **THEN** that card becomes the single selected type, its selected state is exposed to
  assistive technology, and the wizard loads that type's configured form

#### Scenario: Money and vendor pickers stay inline
- **WHEN** the selected type carries money or is configured `requires_vendor`
- **THEN** the currency picker and/or the vendor picker render alongside the type cards

#### Scenario: Edit mode fixes the type
- **WHEN** the wizard is opened to edit an existing draft
- **THEN** the document type is shown read-only and cannot be changed

### Requirement: Create Wizard First-Load Feedback

The Create Document wizard SHALL show non-blocking loading affordances while its initial
reference data (document types, budgets, vendors, items, currencies) is being fetched, so no
step renders a blank or non-functional control as if loading were complete. A failure to load
any reference list SHALL leave the affected control empty without blocking the rest of the form.

#### Scenario: Skeleton while reference data loads
- **WHEN** the wizard mounts and its reference data has not yet arrived
- **THEN** a skeleton/loading affordance is shown in place of the affected controls rather than
  an empty control

#### Scenario: A failed reference load does not block the form
- **WHEN** one of the reference lists fails to load
- **THEN** the affected control is simply empty and the rest of the wizard remains usable

## MODIFIED Requirements

### Requirement: Create Wizard Line-Item Editor Usability

The line-item step SHALL present an aligned, legible editor: on desktop a grid with column
headers shown once and each line aligned beneath them; at narrow widths each line SHALL stack
into a labelled card so no column is clipped. Quantity and unit price SHALL be entered through
numeric inputs that format to the document currency's `decimal_places` and never coerce monetary
values to a JavaScript number. The editor SHALL display a running document total that updates as
quantities and unit prices change, computed as a string formatted by the currency's
`decimal_places`. It SHALL show an explicit empty state with an affordance to add the first line
when no lines exist, and SHALL allow adding and removing lines, each remove control carrying an
accessible label. A line with negative or non-numeric quantity or unit price SHALL receive
per-line feedback that is associated with the offending input for assistive technology, and the
step SHALL NOT be completable until corrected.

#### Scenario: Running total updates as lines change
- **WHEN** a user adds lines or edits a line's quantity or unit price
- **THEN** the displayed document total updates to the sum of the line amounts, formatted by the
  currency's `decimal_places`

#### Scenario: Empty state offers to add the first line
- **WHEN** the line-item step has no lines
- **THEN** an empty state is shown with an affordance that adds the first line

#### Scenario: Invalid numeric input is flagged on the line
- **WHEN** a line's quantity or unit price is negative or non-numeric
- **THEN** that line surfaces feedback associated with the offending input and the step cannot
  be completed until corrected

#### Scenario: Line editor stacks into labelled cards on mobile
- **WHEN** the line-item step is viewed at a narrow (mobile) width
- **THEN** each line stacks into a labelled card with no column clipped or scrolled away

### Requirement: Create Wizard Validation Feedback

The wizard SHALL make validation state unmistakable. Field- and line-level validation errors
SHALL be shown inline next to the offending field or line, not only as a single page-level
banner. When a step fails validation on an attempt to advance, that step SHALL be marked as
failing, the reason surfaced, and focus moved to the first offending input so the user is taken
to the problem. Required fields SHALL carry a visible required indicator and expose
`aria-required` to assistive technology, and an invalid field SHALL expose `aria-invalid` with
its error message associated to it. The Save and Submit actions SHALL reflect a busy state while
in flight and SHALL be prevented from double submission, and any server-side rejection SHALL be
surfaced to the user verbatim. Client-side validation remains UX-only; the server stays
authoritative.

#### Scenario: Advancing past an invalid step is blocked with a reason
- **WHEN** a user attempts to advance from a step whose required inputs are missing or invalid
- **THEN** the step is marked as failing, the specific reason is shown inline at the offending
  input, focus moves to that input, and navigation does not advance

#### Scenario: Required and invalid fields are exposed to assistive technology
- **WHEN** the details step renders a field marked required by configuration, or a field/line
  becomes invalid
- **THEN** the field shows a visible required indicator and exposes `aria-required`, and an
  invalid field exposes `aria-invalid` with its message associated to it

#### Scenario: Server rejection on submit is shown verbatim
- **WHEN** the server rejects a submit (for example a vendor or item not enabled, a missing
  required field, or a closed period)
- **THEN** the server's error message is surfaced to the user and the buttons return from their
  busy state

### Requirement: Create Wizard Responsive and Token-Based Rendering

The Create Document wizard SHALL render correctly across screen sizes and themes. The stepper
and the wizard body SHALL reflow on narrow screens so no content is clipped or horizontally
scrolled away, and the line-item columns SHALL stack into labelled cards at narrow widths. The
running document total and the final Save/Submit actions SHALL remain visible to the user via a
persistent (sticky) summary area rather than scrolling out of view on a long form. All styling
SHALL use PrimeUI theme tokens and SHALL NOT use hardcoded colors, so that both light and dark
modes render correctly. All user-facing strings introduced SHALL be provided through the i18n
layer in both `la` and `en`.

#### Scenario: Wizard reflows on a narrow screen
- **WHEN** the page is viewed at a narrow (mobile) width
- **THEN** the stepper and the step content reflow without clipping, and line-item rows stack
  into labelled cards

#### Scenario: Total and actions stay visible
- **WHEN** the user scrolls a long line-item or review step
- **THEN** the running total (and, on the final step, the Save/Submit actions) remain visible in
  a sticky summary area

#### Scenario: Dark mode renders from theme tokens
- **WHEN** the application is in dark mode
- **THEN** the wizard, the type cards, the review summary, and the line editor render using theme
  tokens with no hardcoded colors

#### Scenario: New strings are localized in both languages
- **WHEN** the wizard renders its new labels (type-card descriptions, totals, empty state,
  required hint, skeleton fallbacks) under either the `la` or `en` locale
- **THEN** every such string resolves through the i18n layer in that language
