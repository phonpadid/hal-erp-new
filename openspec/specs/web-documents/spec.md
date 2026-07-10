# web-documents

## Purpose
The Vue document screens for end users: a company-scoped list and a detail view (header,
field values, line items, attachments, approval log), creation and editing of drafts with
forms rendered dynamically from `form_field` configuration plus line-item capture, submit
and cancel flows that surface server-side errors, and affordances gated by permission code
and document status (client-side UX only; the server remains authoritative).
## Requirements
### Requirement: Document List and Detail

The web app SHALL show the active company's documents (with status) to users holding
`DOC_VIEW`, and a detail view with the document's header, field values, line items,
attachments, approval log, and — when present — its predecessor reference (the source
document's `doc_no`, linked). When the document carries a currency and a locked exchange rate, the
detail SHALL present the document currency, the locked rate, the base-currency label, the base total
and line base amounts, and the lock date (the submit date); monetary amounts SHALL be formatted using
the relevant currency's `decimal_places`. The detail SHALL show the document's vendor (when present)
in the header and, for each line, the line's item and its GL account when present. Attachments SHALL
be downloadable via a server-issued presigned URL. Reads are scoped to the active company by the
server.

#### Scenario: List shows the company's documents

- **WHEN** a user with `DOC_VIEW` opens the documents list
- **THEN** the active company's documents are shown with their status

#### Scenario: Detail renders fields and lines

- **WHEN** the user opens a document
- **THEN** its header, field values, line items, and approval log are displayed

#### Scenario: Detail shows attachments and predecessor

- **WHEN** the user opens a document that has attachments and a predecessor reference
- **THEN** the attachment list (with download links) and a link to the predecessor document are displayed

#### Scenario: Detail shows locked rate and formatted base amounts

- **WHEN** the user opens a submitted foreign-currency document
- **THEN** the document currency, locked rate, base-currency total, and lock date are shown, with
  amounts formatted to each currency's `decimal_places`

#### Scenario: Detail shows vendor and per-line item and GL account

- **WHEN** the user opens a document that has a vendor and lines carrying items
- **THEN** the header shows the vendor and each line shows its item and GL account; lines without an
  item show an empty item/GL

### Requirement: Create and Edit a Draft

The web app SHALL let a `DOC_CREATE` user create a document of a type enabled for their
department, rendering the form dynamically from the type's `form_field` configuration (not
hardcoded), and SHALL let the user reopen and edit an existing draft. Rendering SHALL cover all
field types including `dropdown` (from `options_json`) and `file`, and SHALL evaluate each field's
`condition_json` to show or hide it live as other field values change. The line-item editor SHALL
support adding and deleting rows with numeric validation of quantity and price. A `file` field SHALL
upload attachments via a server-issued presigned URL (bytes go directly to storage), registering
only metadata. Required fields SHALL be validated client-side before save (the server remains
authoritative). The form SHALL let the user choose the document currency from the active currencies
(defaulting to the company base currency) and SHALL show an advisory preview of the converted base
amount (using the exchange-rate resolve read); the chosen currency is sent on save and the server
locks the authoritative rate at submit.

The header SHALL offer an optional vendor picker populated only from the vendors enabled for the
active company (the company-enabled vendor read), mirroring the server's submit-time enablement
guard so an un-enabled vendor cannot be offered; the selected vendor's payment-term days SHALL be
shown as advisory context and the chosen `vendorId` SHALL be sent on save. Each line SHALL offer an
item picker populated only from the items enabled for the active company as the primary way to
charge a line; selecting an item SHALL display that item's default GL account **and** the resolved
budget for the line as read-only (auto-filled, not editable), and SHALL send the line's `itemId` on
save, with the server remaining authoritative for both the GL default and the budget resolution. The
requester SHALL NOT pick a GL code directly. An explicit budget picker (the selectable-budgets read)
SHALL be shown only as a fallback for a line that carries **no** item on a `requires_budget` type;
when an item is selected the line's budget is derived, not picked. Vendor selection is optional; an
item-backed line whose item has no default GL, or for which no active budget resolves, SHALL be
surfaced to the user as an error (the server rejects it), not silently saved.

#### Scenario: Form is rendered from configuration

- **WHEN** the user picks a creatable document type
- **THEN** the form fields shown come from that type's template configuration

#### Scenario: Required field blocks save

- **WHEN** the user tries to save with a required field empty
- **THEN** the client shows a validation error and does not submit

#### Scenario: Conditional field shows and hides live

- **WHEN** the user changes a value that another field's `condition_json` depends on
- **THEN** the dependent field appears or disappears without a page reload

#### Scenario: Dropdown renders its options

- **WHEN** a `dropdown` field is rendered
- **THEN** its choices come from the field's `options_json`

#### Scenario: Upload an attachment

- **WHEN** the user selects a file on a `file` field
- **THEN** the file is uploaded directly to storage via a presigned URL and its metadata is registered on the document

#### Scenario: Delete a line item

- **WHEN** the user removes a line in the line-item editor
- **THEN** that line is removed before save

#### Scenario: Reopen and edit a draft

- **WHEN** a `DOC_CREATE` user opens one of their drafts to edit
- **THEN** its current field values and lines load into the editor and can be changed and saved

#### Scenario: Choose a foreign currency and preview the base amount

- **WHEN** the user selects a document currency different from the company base currency
- **THEN** an advisory converted base amount is shown using the resolved rate, and that currency is
  saved on the document

#### Scenario: Missing preview rate does not block the form

- **WHEN** no rate resolves for the chosen currency and date
- **THEN** the base preview is omitted and the user can still save (the server resolves at submit)

#### Scenario: Vendor picker lists only company-enabled vendors

- **WHEN** the user opens the header vendor picker
- **THEN** only vendors enabled for the active company are offered, and selecting one sends its
  `vendorId` on save

#### Scenario: Picking an item auto-fills its GL and budget read-only

- **WHEN** the user selects an item (from the company-enabled items) on a line
- **THEN** the line shows that item's default GL account and the resolved budget as read-only values
  and sends the line's `itemId` on save, without sending an explicit GL account or budget

#### Scenario: No GL picker is offered to the requester

- **WHEN** the user edits any line
- **THEN** no control lets the requester type or choose a raw GL code; the GL is only ever derived
  from the selected item

#### Scenario: Budget picker appears only for an item-less line

- **GIVEN** a `requires_budget` document
- **WHEN** a line carries no item
- **THEN** the explicit budget picker is offered for that line; and when an item is selected the
  picker is hidden and the budget is shown as derived

#### Scenario: Unresolvable item line surfaces an error

- **WHEN** the user selects an item that has no default GL, or whose GL has no active budget for the
  document's department and year, and tries to submit
- **THEN** the server rejection (naming the GL / department / year) is surfaced to the user and the
  line is not accepted

### Requirement: Submit and Cancel

The web app SHALL let a `DOC_SUBMIT` user submit a draft and a `DOC_CANCEL` user cancel an
own document, reflecting the resulting status. Server-side submit errors (over-budget,
missing field, closed period, vendor/item not enabled) SHALL be surfaced to the user.

#### Scenario: Successful submit advances status

- **WHEN** a valid draft is submitted
- **THEN** the document moves out of DRAFT and the detail reflects the new status

#### Scenario: Server submit error is shown

- **WHEN** submit is rejected by the server (e.g. over budget)
- **THEN** the error message is shown and the document stays DRAFT

### Requirement: Permission-Gated Document Affordances

Document actions SHALL be shown by permission code and document status: create only with
`DOC_CREATE`, submit only with `DOC_SUBMIT` on a DRAFT, cancel only with `DOC_CANCEL`.
Affordances the user lacks are hidden (UX only; the server still enforces).

#### Scenario: Submit hidden without permission

- **WHEN** a user without `DOC_SUBMIT` views their draft
- **THEN** the Submit action is not shown

### Requirement: Document List Filtering

The documents list page SHALL provide a filter bar that drives server-side filtering of the
company-scoped list. The filters SHALL include document status (multi-select), a created-date
range, a document-number search, and an amount range, which are available to any `DOC_VIEW` user.
The filter bar SHALL additionally offer document type, department, and vendor filters whose option
lists come from privileged reads; each such option-backed filter SHALL be shown only when the user
holds the corresponding read permission (`DOC_CREATE` for type, `DEPARTMENT_VIEW` for department,
`MASTER_VIEW` for vendor), mirroring the server's scope rules. Changing any filter SHALL request the
list from the server with the corresponding query parameters and reset to the first page. The
document-number search SHALL be performed server-side (replacing any client-only search that
filtered just the loaded page), so results reflect the full dataset, not only the current page.
Amount-range inputs SHALL be handled as strings and SHALL NOT be coerced to a JavaScript number.
Filter labels SHALL be rendered through the i18n layer in both `la` and `en`.

#### Scenario: Filtering by status requeries the server

- **WHEN** a `DOC_VIEW` user selects one or more statuses in the filter bar
- **THEN** the app requests the list with those statuses as query parameters, resets to page 1, and
  shows the matching documents across the full dataset

#### Scenario: Document-number search is server-side

- **WHEN** the user types a document number fragment into the search
- **THEN** the app sends it as a server query parameter and the results include matches beyond the
  currently loaded page

#### Scenario: Amount range is sent as strings

- **WHEN** the user enters a minimum and maximum amount
- **THEN** the values are sent to the server as decimal strings and are never converted to a
  JavaScript number on the client

#### Scenario: Clearing filters restores the unfiltered list

- **WHEN** the user clears the active filters
- **THEN** the app requests the list with no filter parameters and shows the full company-scoped list

#### Scenario: Option-backed filters are gated by their read permission

- **WHEN** a user without `DEPARTMENT_VIEW` (or `MASTER_VIEW`, or `DOC_CREATE`) opens the documents list
- **THEN** the department (respectively vendor, or document-type) filter is not shown, while the
  status, date-range, document-number, and amount filters remain available

### Requirement: Create Document from Predecessor

The web app SHALL let a `DOC_CREATE` user create a document from an eligible predecessor (e.g.
PR→PO, advance→clear-advance), choosing the predecessor and producing a draft seeded with the
copied header and line items. The affordance SHALL be shown only where permitted and the
predecessor picker SHALL list only documents the user may reference.

#### Scenario: Create-from seeds a draft

- **WHEN** the user creates a document from an approved predecessor
- **THEN** a draft opens pre-filled with the predecessor's copied header fields and line items, with its reference set

#### Scenario: Server rejection is surfaced

- **WHEN** the server rejects the create-from (e.g. predecessor not approved or disallowed pairing)
- **THEN** the error is shown and no draft is created

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

### Requirement: Detail Header Grouping and Action Priority

The document detail header SHALL present the document's identity and state as a scannable summary:
the document number as title, the status as a severity-colored tag, and a meta line carrying the
document type and the document's created date and submit/lock date when present (the requester is
out of scope here because the detail endpoint does not expose it, and this change makes no backend
change). The header SHALL surface the
document's headline total (formatted by the document currency's `decimal_places`) alongside the
status. Header actions SHALL be grouped into a primary cluster — the approval decision actions
Approve / Reject / Return, shown only when the user may act on the document — visually separated
from a secondary cluster of utility actions (Edit, Submit, Cancel, Create successor, Receive). Every
action SHALL remain gated by the same permission code and document status as before; grouping is
presentation only and MUST NOT change which actions appear.

#### Scenario: Header shows identity, status, and headline total

- **WHEN** a user opens a document that has a total amount
- **THEN** the header shows the document number, a status tag, a meta line with the document type and
  the created/submit-lock dates, and the headline total formatted by the document currency's
  `decimal_places`

#### Scenario: Approval actions are grouped ahead of utilities

- **WHEN** an eligible approver opens a document awaiting their action
- **THEN** the Approve / Reject / Return actions are shown as a primary group, visually separated
  from the secondary utility actions

#### Scenario: Grouping does not change gating

- **WHEN** a user lacks the permission or the status precondition for an action
- **THEN** that action is hidden exactly as before, regardless of its group

### Requirement: Detail Summary Emphasis

The detail summary SHALL render the document's currency, locked exchange rate, total, base total,
lock date, vendor (when present), and predecessor link (when present) as labelled definition pairs,
with the grand total and base total given greater visual weight than the secondary facts. Monetary
amounts SHALL be formatted using the relevant currency's `decimal_places`, and the predecessor SHALL
remain a link that navigates to the source document.

#### Scenario: Total is emphasized in the summary

- **WHEN** the user views a document's summary
- **THEN** the grand total and base total are visually emphasized above the secondary facts, each
  amount formatted to its currency's `decimal_places`

#### Scenario: Predecessor link navigates to the source

- **WHEN** the user opens a document that has a predecessor reference and clicks the predecessor link
- **THEN** the app navigates to the source document's detail view

### Requirement: Detail Table Scannability and Totals

The line-item table SHALL right-align its numeric columns (quantity, unit price, line amount, base
line amount) and SHALL show a totals row summing the line and base-line amounts for display; the
summary's headline figure remains the server-provided document total, not the client-summed value.
The 3-way matching table SHALL apply the same numeric alignment and keep its per-line result tag.
When a document has no line items, the line-items section SHALL show an explicit empty state rather
than an empty table.

#### Scenario: Numeric columns are right-aligned with a totals row

- **WHEN** the user views a document that has line items
- **THEN** the numeric columns are right-aligned and a totals row shows the summed line and base-line
  amounts, each formatted to its currency's `decimal_places`

#### Scenario: Document with no lines shows an empty state

- **WHEN** the user opens a document that has no line items
- **THEN** an explicit empty state is shown in place of an empty line-items table

### Requirement: Detail Responsive and Token-Based Rendering

The detail page SHALL reflow on narrow screens — the header stacks and its actions wrap, and wide
tables scroll within their own container without breaking the page layout — and SHALL render using
only PrimeUI theme tokens so that light and dark modes both display correctly. Every user-facing
string introduced by this presentation MUST be localized in both supported languages.

#### Scenario: Detail reflows on a narrow screen

- **WHEN** the detail page is viewed at a narrow (mobile) width
- **THEN** the header stacks with its actions wrapping and wide tables scroll within their container
  without horizontal overflow of the page

#### Scenario: Dark mode renders from theme tokens

- **WHEN** the detail page is viewed with dark mode active
- **THEN** all sections render from theme tokens with no hardcoded colors

#### Scenario: New strings are localized in both languages

- **WHEN** the detail page is viewed in either supported language
- **THEN** every label introduced by this change is shown localized, with no missing-key fallback

### Requirement: Per-Line Budget Selection in the Create Wizard

The Create Document wizard SHALL let a `DOC_CREATE` user assign a budget to each line of a
budget-controlled document (`document_type.requires_budget`), populating the per-line budget
selector from the selectable-budgets read (which returns `id`, `budgetName`, and `glAccount`
and is itself authorized by `DOC_CREATE`). The affordance SHALL be shown to `DOC_CREATE`
creators and SHALL NOT be gated on `BUDGET_VIEW`; a creator without `BUDGET_VIEW` SHALL still
be able to see and choose a budget for a line. The selector SHALL send the chosen `budgetId` on
save, with the server remaining authoritative for reservation at submit. The Budgets pages
(balances, breakdown, ledger) remain gated by `BUDGET_VIEW` and are unaffected.

#### Scenario: Creator without BUDGET_VIEW sees the budget selector

- **GIVEN** a signed-in user holding `DOC_CREATE` but not `BUDGET_VIEW`
- **WHEN** the user opens the Create wizard for a `requires_budget` document type
- **THEN** each line offers a budget selector populated from the selectable-budgets read

#### Scenario: Selected budget is sent on save

- **WHEN** the creator chooses a budget for a line and saves the draft
- **THEN** that line's `budgetId` is sent to the server

#### Scenario: Budget balances are not exposed by the selector

- **WHEN** the creator opens the per-line budget selector
- **THEN** each option shows only its label (e.g. GL account / name) and no budget amount or
  available balance

### Requirement: Create Wizard Currency Picker Available to Creators

The Create Document wizard SHALL populate its document-currency picker from the
selectable-currencies read (active currencies with `code`, `name`, `symbol`, `decimalPlaces`),
which is authorized by `DOC_CREATE`. A `DOC_CREATE` user SHALL be able to choose the document
currency without holding `CURRENCY_VIEW`; the picker SHALL default to the company base currency
and the chosen currency SHALL be sent on save (the server locks the authoritative rate at
submit). The currency-administration pages remain gated by their own permissions
(`CURRENCY_VIEW` / `CURRENCY_MANAGE`) and are unaffected.

#### Scenario: Creator without CURRENCY_VIEW can choose a currency

- **GIVEN** a signed-in user holding `DOC_CREATE` but not `CURRENCY_VIEW`
- **WHEN** the user opens the Create wizard
- **THEN** the currency picker is populated with the active currencies and no 403 blocks the
  wizard

#### Scenario: Currency picker defaults to the company base currency

- **WHEN** the wizard first renders for a new document
- **THEN** the selected currency defaults to the company base currency

### Requirement: Pending Approver Entry in the Detail Timeline

The document detail view SHALL show, after the approval history, a **pending** entry for a
document that is `IN_APPROVAL`, describing who the document is waiting on. The entry SHALL show
the current step (number/name) and its approval mode, and SHALL list the approver(s) from the
pending-step approver read: for a role-targeted step, the role name together with the eligible
holders; for a user-targeted step, the named approver. When an eligible actor is a delegate, the
entry SHALL indicate the principal they act for. The pending entry SHALL be shown only to users
the read returns it to (participants); other viewers SHALL see the history without it. The entry
is informational and SHALL NOT imply the current viewer can act (action affordances remain gated
by their existing permission and step eligibility).

#### Scenario: Requester sees the pending step and its approvers

- **GIVEN** the requester opens the detail of their `IN_APPROVAL` document
- **WHEN** the timeline renders
- **THEN** a pending entry after the history shows the current step and the approver(s) it is
  waiting on

#### Scenario: Role-targeted step shows role name and people

- **GIVEN** the current step targets a role held by two users
- **WHEN** the requester views the pending entry
- **THEN** it shows the role name and both eligible people

#### Scenario: No pending entry once the document leaves approval

- **GIVEN** a document that is `APPROVED` (or `DRAFT`)
- **WHEN** the detail timeline renders
- **THEN** no pending entry is shown, only the history

### Requirement: Detail Summary Stat Tiles

The document detail view SHALL present the document's headline figures as a scannable
stat-tile row, rendered with the shared KPI tile component, positioned between the hero
header and the detail content sections. The row SHALL include the document Total (with its
currency code), the number of Line items, and the number of Attachments. When the document's
currency differs from the company base currency, the row SHALL additionally include the Base
total (with the base-currency code) and the locked Exchange rate; for a document already in
the base currency these two tiles SHALL be omitted to avoid redundant information. When the
document has no header total set, the Total tile SHALL fall back to the summed line-item
total so it never shows an empty value while the line-items footer shows a figure. Monetary
tile values SHALL be formatted using the relevant currency's `decimal_places`, and money
SHALL never be rendered from a JavaScript number.

To avoid duplication, each figure SHALL appear once: the document Status SHALL be shown only
by the hero header status badge (not repeated as a tile); the Total SHALL be shown only in
the stat-tile row (not repeated as a hero headline); and the redundant "Summary" descriptive
card SHALL be removed, with its non-duplicated descriptive fields (vendor and predecessor
reference) relocated to the hero header meta line.

This requirement changes only the presentation of figures the detail view already loads;
it introduces no new data, no additional server calls, and no change to company scope,
permissions, or the authoritative document state. The descriptive fields that are not
headline figures (vendor, rate-locked timestamp, predecessor reference, field values, line
items, approval log, attachments) SHALL remain available on the page.

#### Scenario: Stat tiles render on the detail view

- **WHEN** a `DOC_VIEW` user opens a document detail
- **THEN** a stat-tile row is shown with tiles for Total (with currency code), Line items
  count, and Attachments count, above the detail content sections

#### Scenario: No duplicated figures across the page

- **WHEN** a `DOC_VIEW` user opens a document detail
- **THEN** the status appears only on the hero header badge (no status tile), the total
  appears only in the stat-tile row (no hero headline total), and there is no separate
  "Summary" card repeating currency or rate-locked date

#### Scenario: Total tile falls back to the line-item total

- **WHEN** the document has no header total set but has line items
- **THEN** the Total tile shows the summed line-item total (formatted per currency), matching
  the line-items footer, instead of an empty value

#### Scenario: Base-currency and exchange-rate tiles appear only for foreign currency

- **WHEN** the opened document's currency differs from the company base currency
- **THEN** the row additionally shows a Base total tile (with the base-currency code) and an
  Exchange rate tile
- **WHEN** the opened document is already in the company base currency
- **THEN** the Base total and Exchange rate tiles are omitted

#### Scenario: Count tiles reflect the document contents

- **WHEN** the document has N line items and M attachments
- **THEN** the Line items tile shows N and the Attachments tile shows M

#### Scenario: Monetary tiles respect currency decimal places

- **WHEN** the Total and Base total tiles are rendered
- **THEN** each amount is formatted using its currency's `decimal_places` and is not derived
  from a JavaScript number

#### Scenario: Empty line-item columns are hidden

- **WHEN** an optional line-item column (item, GL account, description, base amount, received
  quantity / line status) has no value on any row
- **THEN** that column is not shown, so the line-items table does not render a column of empty
  placeholders

#### Scenario: Only filled field values are shown

- **WHEN** the document's form fields include values that were left blank
- **THEN** only the fields that have a value are listed, and the Fields card is hidden when no
  field has a value

#### Scenario: Header presented as a status-stamped ticket with breadcrumb

- **WHEN** a `DOC_VIEW` user opens a document detail
- **THEN** a breadcrumb (documents list / document type / document number) is shown above a
  header that carries a status-colored left stripe, the document-type label, the document
  number, and a status badge, with the available actions grouped alongside the header

#### Scenario: Approval history presented as a stepper

- **WHEN** the document has approval-log entries and/or a current pending step
- **THEN** the approval history is rendered as a stepper — each acted step a completed node
  with a connector, and the current waiting step an emphasized (active) node — and an empty
  state is shown when there are no steps

### Requirement: Draft Detail Prompts for Missing Required Fields

The document Detail view SHALL, for a DRAFT document the signed-in user may edit, detect visible required form fields whose value is empty and surface them as an inline notice. The notice MUST list the missing fields by their form-field label and MUST offer a single action that opens the edit wizard for the document landed on the fields (Details) step. The notice MUST NOT appear when the document is not a draft, when the user lacks edit permission, or when every visible required field already has a value. Field visibility MUST be evaluated with the same conditional-visibility rules used elsewhere, so a hidden field is never reported as missing. This is a client-side convenience only; the server submit gate remains the authoritative enforcement of required fields.

#### Scenario: Draft with an empty required field shows the prompt
- **WHEN** a user who may edit opens the Detail of a DRAFT document whose visible required field `reason` is empty
- **THEN** an inline notice is shown listing `Reason` as a missing required field, with an action to complete it

#### Scenario: Prompt lists only visible required fields
- **WHEN** a DRAFT document has a required field that is hidden by its condition and another visible required field that is empty
- **THEN** the notice lists only the visible empty required field and omits the hidden one

#### Scenario: No prompt when required fields are filled
- **WHEN** a user opens the Detail of a DRAFT document whose visible required fields all have values
- **THEN** no missing-required-fields notice is shown

#### Scenario: No prompt on a non-draft or without edit permission
- **WHEN** the document is not a draft, or the user lacks permission to edit it
- **THEN** no missing-required-fields notice is shown regardless of field values

### Requirement: Edit Wizard Opens on a Requested Step

The create/edit document wizard SHALL support opening on a caller-specified step supplied through the route, and MUST fall back to the first step when none is specified or the value does not match a known step. When opened on the Details step for a draft with missing required fields, the wizard SHOULD move focus to the first empty required field so the user can complete it immediately.

#### Scenario: Deep link lands on the Details step
- **WHEN** the edit wizard is opened for a draft with a route request to start on the Details step
- **THEN** the wizard is shown with the Details step active rather than the first step

#### Scenario: Unknown or absent step falls back to the first step
- **WHEN** the edit wizard is opened with no step request, or with a step value that matches no wizard step
- **THEN** the wizard is shown with its first step active

#### Scenario: Focus lands on the first empty required field
- **WHEN** the edit wizard opens on the Details step for a draft whose required field `reason` is empty
- **THEN** input focus is placed on the `reason` field

