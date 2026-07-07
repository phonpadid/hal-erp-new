## ADDED Requirements

### Requirement: Create Wizard Review Summary

The Create Document wizard's final (Review) step SHALL present a complete, read-only summary of
exactly what will be submitted, derived from the same form state the editing steps bind so it
cannot drift from the submitted document. The summary SHALL show the document type; the document
currency and, when the currency differs from the company base currency, the advisory converted
base amount and a note that the rate is locked at submit; the selected vendor when the document
type requires a vendor; every dynamic field that is currently visible under its `condition_json`
with its label and value (and SHALL omit hidden conditional fields); and the full list of line
items with each line's amount and a grand total. All monetary amounts SHALL be formatted using
the relevant currency's `decimal_places` and SHALL be carried as strings, never coerced to a
JavaScript number.

#### Scenario: Review summarizes a money document before submit
- **WHEN** a user reaches the Review step for a document type that carries amounts (e.g. a
  procurement type) with a vendor, visible fields, and several lines entered
- **THEN** the Review step shows the type, the currency, the vendor, each visible field's
  label and value, every line with its amount, and a grand total formatted by the currency's
  `decimal_places`

#### Scenario: Review hides conditional fields that are not visible
- **WHEN** a dynamic field is hidden by its `condition_json` at the time of review
- **THEN** that field does not appear in the Review summary

#### Scenario: Review shows the foreign-currency base preview
- **WHEN** the chosen document currency differs from the company base currency and an advisory
  rate is available
- **THEN** the Review step shows the converted base amount and indicates the rate is locked at
  submit; **AND WHEN** no advisory rate is available the preview is omitted without blocking
  submit

### Requirement: Create Wizard Line-Item Editor Usability

The line-item step SHALL present an aligned, legible editor with column headers shown once and
each line aligned beneath them. It SHALL display a running document total that updates as
quantities and unit prices change, computed as a string formatted by the currency's
`decimal_places`. It SHALL show an explicit empty state with an affordance to add the first line
when no lines exist, and SHALL allow adding and removing lines. Quantity and unit price SHALL
receive per-line numeric feedback, and the editor SHALL NOT coerce monetary values to a
JavaScript number.

#### Scenario: Running total updates as lines change
- **WHEN** a user adds lines or edits a line's quantity or unit price
- **THEN** the displayed document total updates to the sum of the line amounts, formatted by the
  currency's `decimal_places`

#### Scenario: Empty state offers to add the first line
- **WHEN** the line-item step has no lines
- **THEN** an empty state is shown with an affordance that adds the first line

#### Scenario: Invalid numeric input is flagged on the line
- **WHEN** a line's quantity or unit price is negative or non-numeric
- **THEN** that line surfaces numeric feedback and the step cannot be completed until corrected

### Requirement: Create Wizard Validation Feedback

The wizard SHALL make validation state unmistakable. Field-level validation errors SHALL be
shown inline next to the offending field or line. When a step fails validation on an attempt to
advance, that step SHALL be marked as failing and the reason surfaced to the user. Required
fields SHALL carry a visible required indicator. The Save and Submit actions SHALL reflect a
busy state while in flight and SHALL be prevented from double submission, and any server-side
rejection SHALL be surfaced to the user verbatim. Client-side validation remains UX-only; the
server stays authoritative.

#### Scenario: Advancing past an invalid step is blocked with a reason
- **WHEN** a user attempts to advance from a step whose required inputs are missing or invalid
- **THEN** the step is marked as failing and the specific reason is shown, and navigation does
  not advance

#### Scenario: Required fields show an indicator
- **WHEN** the details step renders a field marked required by configuration
- **THEN** that field shows a visible required indicator

#### Scenario: Server rejection on submit is shown verbatim
- **WHEN** the server rejects a submit (for example a vendor or item not enabled, a missing
  required field, or a closed period)
- **THEN** the server's error message is surfaced to the user and the buttons return from their
  busy state

### Requirement: Create Wizard Responsive and Token-Based Rendering

The Create Document wizard SHALL render correctly across screen sizes and themes. The stepper
and the wizard body SHALL reflow on narrow screens so no content is clipped or horizontally
scrolled away, and the line-item columns SHALL stack with labels at narrow widths. All styling
SHALL use PrimeUI theme tokens and SHALL NOT use hardcoded colors, so that both light and dark
modes render correctly. All user-facing strings introduced SHALL be provided through the i18n
layer in both `la` and `en`.

#### Scenario: Wizard reflows on a narrow screen
- **WHEN** the page is viewed at a narrow (mobile) width
- **THEN** the stepper and the step content reflow without clipping, and line-item columns stack
  with their labels

#### Scenario: Dark mode renders from theme tokens
- **WHEN** the application is in dark mode
- **THEN** the wizard, the review summary, and the line editor render using theme tokens with no
  hardcoded colors

#### Scenario: New strings are localized in both languages
- **WHEN** the wizard renders its new labels (review headings, totals, empty state, required
  hint) under either the `la` or `en` locale
- **THEN** every such string resolves through the i18n layer in that language
