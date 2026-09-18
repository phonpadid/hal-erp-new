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

The detail SHALL additionally show the budget movements a document carries — the movement type, the
budget it names (its code and name, linked to that budget) and the amount — for a document whose
content lives on `budget_movement` rather than on lines. Such a document has no lines at all, so a
screen that renders only lines states "no items" about a document that activates twelve million kip.

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

#### Scenario: A budget movement document says what it moves

- **WHEN** the user opens a document whose `post_action` activates or adjusts a budget
- **THEN** the detail shows the movement type, the budget's code and name, and the amount, and the
  budget links to its own page

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
charge a line; selecting an item SHALL display that item's default GL account as read-only (not
editable) and SHALL send the line's `itemId` on save, with the server remaining authoritative for
the GL default. The requester SHALL NOT pick a GL code directly. The budget is a separate fact and
is named by the requester: the budget picker (the selectable-budgets read) SHALL be shown on every
line of a `requires_budget` type, item-backed or not, as the *Per-Line Budget Selection in the
Create Wizard* requirement states. Vendor selection is optional; an item-backed line whose item has
no default GL SHALL be surfaced to the user as an error (the server rejects it), not silently saved.

The pickers for the selections the TYPE asks for — warehouse, destination warehouse, related
employee and vendor — SHALL remain usable while the document is a draft, and the choice SHALL be
persisted on save. These are not field values and not lines, so the promise above does not reach
them; they were write-once at creation, and a draft lacking one showed it blank, disabled and
required at the same time, with the step refusing to advance and nothing the user could do about it.
A draft whose type gained `requires_warehouse` or `requires_employee` after it was created is in
exactly that state through no act of its author. The pickers SHALL offer the same company-scoped,
active/enabled records the create wizard offers, and SHALL be disabled once the document has left
`DRAFT`, where the server refuses the change.

Reopening a draft SHALL restore every value the document holds, whatever shape the read returns it
in — a populated relation or a bare id. A value the form cannot restore SHALL be shown as missing
and required rather than as an empty control.

The budget picker SHALL offer the budgets the selectable-budgets read returns for this caller,
without narrowing them further. It SHALL NOT send the signed-in user's own department as though it
were an authorization: that made the picker answer a question the server had already answered, and
answer it wrongly for anyone granted more than one department.

Budgets the caller's own department does not hold — money the company carries in common — SHALL be
offered alongside its own and SHALL be distinguishable from them, so a requester charging shared
money can see that is what they are doing before they save.

An empty required picker is indistinguishable from one the user never filled, so they re-pick it and
save, and whatever else the load dropped goes with it. That is not hypothetical here: a draft
recording the day its money moved came back with its budget blank and its day blank, and saving the
amount alone would have moved the spend into the quarter it was edited in.

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

#### Scenario: Picking an item shows its GL read-only

- **WHEN** the user selects an item (from the company-enabled items) on a line
- **THEN** the line shows that item's default GL account as a read-only value and sends the line's
  `itemId` on save, without sending an explicit GL account

#### Scenario: No GL picker is offered to the requester

- **WHEN** the user edits any line
- **THEN** no control lets the requester type or choose a raw GL code; the GL is only ever derived
  from the selected item

#### Scenario: Budget picker appears on every line of a budget-controlled type

- **GIVEN** a `requires_budget` document
- **WHEN** a line is rendered, whether or not it carries an item
- **THEN** the budget picker is offered for that line and remains editable

#### Scenario: Unresolvable item line surfaces an error

- **WHEN** the user selects an item that has no default GL for the active company and tries to submit
- **THEN** the server rejection (naming the item and the active company) is surfaced to the user and
  the line is not accepted

#### Scenario: A draft missing a required selection can still be given one

- **GIVEN** a draft of a `requires_warehouse` type that names no warehouse
- **WHEN** a `DOC_CREATE` user reopens it
- **THEN** the warehouse picker is usable, and choosing a warehouse lets the wizard advance and the
  choice is saved on the document

#### Scenario: A saved selection is shown as saved

- **WHEN** a `DOC_CREATE` user reopens a draft that names a warehouse, a related employee or a vendor
- **THEN** each picker shows the record the draft was saved with rather than its placeholder

#### Scenario: A submitted document's selections are not offered for editing

- **WHEN** a user opens a document that has left `DRAFT`
- **THEN** the selection pickers are disabled

#### Scenario: A reopened draft keeps its line's budget

- **GIVEN** a saved draft whose line charges a budget
- **WHEN** the user reopens it
- **THEN** the line's budget is filled in, not empty and invalid

#### Scenario: A reopened draft keeps the day its money moved

- **GIVEN** a saved draft of a type that records past events, stating a day
- **WHEN** the user reopens it, changes the amount only, and saves
- **THEN** the stated day is unchanged

#### Scenario: A value that cannot be restored reads as missing

- **GIVEN** a draft whose line charges a budget that has since been closed
- **WHEN** the user reopens it
- **THEN** the field is shown as missing and required, not as an empty control

#### Scenario: The picker offers what the caller may charge

- **GIVEN** a `DOC_CREATE` user whose grant reaches more than their own department
- **WHEN** they open the line's budget picker
- **THEN** every budget the selectable-budgets read returns for them is offered, and the client
  narrows the list no further

#### Scenario: A shared budget is marked as shared in the picker

- **GIVEN** a budget the caller's department does not hold, offered because it is shared
- **WHEN** the picker is opened
- **THEN** that budget is shown as shared, distinguishably from the caller's own department's

#### Scenario: A requester in a department holding no budget can still charge one

- **GIVEN** a user in a department that holds no budget of its own
- **WHEN** they open the line's budget picker on a `requires_budget` type
- **THEN** the budgets their grant and the shared nodes allow are offered, and the picker is not
  empty

### Requirement: Submit and Cancel

The web app SHALL let a `DOC_SUBMIT` user submit a draft and a `DOC_CANCEL` user cancel an
own document, reflecting the resulting status. When the document type has `requires_quota = true`,
the submit call SHALL include the `quotaReservations` the requester built (each with a `quotaId` and
`qty`) in the `POST /documents/:id/submit` body; for other types the body carries no reservations.
A quota-controlled draft SHALL be submitted through the wizard, which owns the reservation state;
the document-detail Submit affordance for a `requires_quota` draft SHALL route into the wizard's
quota/review step rather than submit an empty body. Server-side submit errors (over-budget,
over-quota, no quota reservation declared, no linked employee for a personal quota, missing field,
closed period, vendor/item not enabled) SHALL be surfaced to the user.

Cancelling SHALL let the user state a reason, sent as the request's `remark` and kept on the
withdrawal's audit row. The reason SHALL be optional — a withdrawal is the author's own second
thoughts, and the act SHALL NOT be refused for want of one.

Cancelling a document that is `SUBMITTED` or `IN_APPROVAL` takes it away from people who are
holding it, so the confirmation SHALL say so rather than presenting the same prompt a draft gets.

#### Scenario: Successful submit advances status

- **WHEN** a valid draft is submitted
- **THEN** the document moves out of DRAFT and the detail reflects the new status

#### Scenario: Quota-controlled submit includes reservations

- **WHEN** a valid `requires_quota` draft is submitted from the wizard
- **THEN** the submit request carries the `quotaReservations` array and the document moves out of
  DRAFT

#### Scenario: Server submit error is shown

- **WHEN** submit is rejected by the server (e.g. over budget, over quota, or no quota reservation
  declared)
- **THEN** the error message is shown and the document stays DRAFT

#### Scenario: A reason may be given when withdrawing

- **WHEN** a `DOC_CANCEL` user withdraws their document and types a reason
- **THEN** the reason is sent as `remark` with the cancel request

#### Scenario: Withdrawing without a reason still works

- **WHEN** the user confirms the withdrawal leaving the reason empty
- **THEN** the request is sent with no `remark` and the document is withdrawn

#### Scenario: Withdrawing from approval says who it affects

- **WHEN** the user withdraws a document that is `SUBMITTED` or `IN_APPROVAL`
- **THEN** the confirmation states that it is currently with approvers, rather than showing the
  prompt used for a draft

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

The filter bar SHALL additionally offer document type, department, and vendor filters. Each
option-backed filter SHALL be shown only when the user holds the read permission that governs its
option list, mirroring the server's scope rules: `DEPARTMENT_VIEW` for department, `MASTER_VIEW`
for vendor, and `DOC_VIEW` for document type. The document-type filter SHALL be gated by `DOC_VIEW`
rather than `DOC_CREATE`, and its option list SHALL be the document types that occur within the
list the user can see, not the types the user is entitled to create. A reader filtering documents
that other people raised is asking which types are present; answering with the types they may
author leaves a reviewer who creates nothing with an empty filter over a populated list.

An option-backed filter SHALL distinguish an option list that is empty from one that failed to
load, and SHALL NOT present a failed read as an empty list.

Changing any filter SHALL request the
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

- **WHEN** a user without `DEPARTMENT_VIEW` (or `MASTER_VIEW`) opens the documents list
- **THEN** the department (respectively vendor) filter is not shown, while the status, date-range,
  document-number, amount, and document-type filters remain available

#### Scenario: A reviewer who creates nothing can still filter by type

- **GIVEN** a `DOC_VIEW` user who holds no `DOC_CREATE` for any document type in this company
- **WHEN** they open the documents list and open the document-type filter
- **THEN** the filter is present and offers every type occurring in the list they can see

#### Scenario: The type filter offers the types present, not the types creatable

- **GIVEN** a user entitled to create one document type, viewing a list containing three types
- **WHEN** they open the document-type filter
- **THEN** it offers the three types present in the list

#### Scenario: A type-filter read failure is not shown as an empty list

- **GIVEN** a `DOC_VIEW` user whose document-type option request fails
- **WHEN** they open the document-type filter
- **THEN** it states that the options could not be loaded rather than that there are none

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
with its label and value (and SHALL omit hidden conditional fields); the full list of line
items with each line's amount and a grand total; and, when the document type has
`requires_quota = true`, the list of quota reservations that will be submitted, each showing the
quota and the quantity. All monetary amounts SHALL be formatted using
the relevant currency's `decimal_places` and SHALL be carried as strings, never coerced to a
JavaScript number.

#### Scenario: Review summarizes a money document before submit
- **WHEN** a user reaches the Review step for a document type that carries amounts (e.g. a
  procurement type) with a vendor, visible fields, and several lines entered
- **THEN** the Review step shows the type, the currency, the vendor, each visible field's
  label and value, every line with its amount, and a grand total formatted by the currency's
  `decimal_places`

#### Scenario: Review lists the quota reservations before submit
- **WHEN** a user reaches the Review step for a `requires_quota` document with one or more
  reservations entered
- **THEN** the Review step lists each reservation's quota and quantity, matching what will be sent
  in `quotaReservations`

#### Scenario: Review hides conditional fields that are not visible
- **WHEN** a dynamic field is hidden by its `condition_json` at the time of review
- **THEN** that field does not appear in the Review summary

#### Scenario: Review shows the foreign-currency base preview
- **WHEN** the chosen document currency differs from the company base currency and an advisory
  rate is available
- **THEN** the Review step shows the converted base amount and indicates the rate is locked at
  submit; **AND WHEN** no advisory rate is available the preview is omitted without blocking
  submit

### Requirement: A Date Field Keeps What Was Typed Or Says It Did Not

A date field SHALL accept a typed date as well as one chosen from its calendar. A typed value that
parses SHALL be kept. A typed value that does not parse SHALL be reported to the user: the control
SHALL be marked invalid AND SHALL name the format it accepts.

Silently discarding it is the failure to remove. A field that takes keystrokes, displays them, and
then throws them away gives the user no reason to look again: a promotion submitted this way carried
no effective date at all, the review step showed only a dash, and nothing at any stage said the date
had been dropped.

The requirement is that the rejection is *reported*, not that the text survives. The date control
clears its own box on input it cannot parse and that is not preventable from outside it, which is
exactly why a marker alone is not enough — a red border around a box that just emptied itself
explains nothing. The message is what carries the meaning.

The stored value SHALL remain the ISO `yyyy-mm-dd` string the rest of the form expects, and the
format a user may type SHALL be the format the field displays, so what is shown and what is accepted
agree.

#### Scenario: A typed date is kept

- **WHEN** a user types a date into a date field and moves on
- **THEN** the value is carried into the review step and stored

#### Scenario: An unparseable date is refused visibly

- **WHEN** a user types something that is not a date
- **THEN** the field is marked invalid and shows the format it accepts, rather than emptying itself
  with no explanation

#### Scenario: The calendar still works

- **WHEN** a user picks a date from the calendar
- **THEN** the value is stored as before

### Requirement: The Review Step Shows a Missing Required Value As Missing

The wizard's review step SHALL distinguish a field left empty from a field whose value it cannot
show. Where a required field has no value, the review SHALL mark it as missing rather than rendering
a placeholder that reads like a legitimate blank.

The review step is the last screen before a document becomes somebody else's work, and a dash in a
column is not a warning. The promotion that lost its effective date showed exactly the same dash a
genuinely optional empty field shows.

#### Scenario: A missing required value is marked

- **GIVEN** a document whose required date field has no value
- **WHEN** the review step renders
- **THEN** that field is marked as missing rather than shown as an ordinary blank

#### Scenario: An optional empty field is not marked

- **GIVEN** a document whose optional field is empty
- **WHEN** the review step renders
- **THEN** it is shown as blank without a warning

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
picker SHALL remain available, both alongside the type selection. Choosing a type that carries an
`authoring_route` SHALL navigate to that screen instead of advancing the wizard. In edit mode the
type is fixed and the cards SHALL render in a read-only, non-interactive form. When the type list is
still loading, a skeleton placeholder SHALL be shown in place of the cards.

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

#### Scenario: A type authored elsewhere leaves the wizard
- **WHEN** the chosen type carries an `authoring_route`
- **THEN** the wizard navigates to that screen rather than loading its configured form

### Requirement: Choosing a Type Authored Elsewhere Goes There

The create wizard SHALL keep every type the department may raise in its card grid, including the
types whose content the generic form cannot author. Choosing a card whose type carries an
`authoring_route` SHALL navigate to that screen instead of advancing to the wizard's next step.

The grid is the inventory of what this department may raise, and a requester looking for leave looks
where documents are made. Omitting such a type would hide a capability that exists; continuing into
a generic form produces a document that cannot work.

When a type's `authoring_route` names a screen the client does not recognise, the wizard SHALL
continue into its own steps rather than dead-ending, so a misconfigured route degrades to today's
behaviour instead of a blank page.

#### Scenario: Leave goes to the leave screen

- **WHEN** a `DOC_CREATE` user chooses the leave card
- **THEN** they arrive at the leave request screen rather than the wizard's detail step

#### Scenario: A budget plan goes to the budget screen

- **WHEN** a user chooses the budget-plan card
- **THEN** they arrive at the screen that authors budget plans

#### Scenario: An unrecognised route falls back to the wizard

- **GIVEN** a type whose `authoring_route` names no known screen
- **WHEN** the card is chosen
- **THEN** the wizard advances to its own detail step

### Requirement: The Wizard Collects a Warehouse When the Type Requires One

When the chosen type is configured `requires_warehouse`, the wizard SHALL offer a selector of the
active company's warehouses, and SHALL send it as the document's warehouse on save. When the type's
`post_action` is `TRANSFER_STOCK` it SHALL additionally offer a destination warehouse, and the two
SHALL be required to differ.

Submit refuses a warehouse-requiring document that names none. Without these controls the refusal is
unanswerable: the message asks for a warehouse on a screen that has nowhere to put one, and the
document can only ever be a draft.

The wizard SHALL read `requires_warehouse` and `post_action` from the document-type payload rather
than inferring them from the type's code.

#### Scenario: A goods issue names a warehouse and submits

- **GIVEN** a document type with `requires_warehouse` true
- **WHEN** a user completes the wizard choosing a warehouse
- **THEN** the document is submitted rather than left as a draft

#### Scenario: A transfer asks for both ends

- **GIVEN** a type whose `post_action` is `TRANSFER_STOCK`
- **WHEN** the wizard renders its detail step
- **THEN** both a source and a destination warehouse are offered, and choosing the same one twice is
  rejected

#### Scenario: A type that needs no warehouse is not asked for one

- **GIVEN** a document type with `requires_warehouse` false
- **WHEN** the wizard renders its detail step
- **THEN** no warehouse selector is shown

### Requirement: The Wizard Collects an Employee When the Type Requires One

When the chosen type is configured `requires_employee`, the wizard SHALL offer a selector of the
active company's employees and SHALL send the choice as the document's related employee.

A promotion or resignation that names nobody is approvable and inert. The picker is what makes the
document say who it is about, so the post-action has a subject to act on.

#### Scenario: A promotion names its subject

- **GIVEN** a document type with `requires_employee` true
- **WHEN** the wizard renders its detail step
- **THEN** an employee selector is offered, and the chosen employee is carried on the document

#### Scenario: Submitting without an employee is refused

- **WHEN** such a document is submitted with no employee chosen
- **THEN** the submit is refused and the wizard says which field is missing

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

The Create Document wizard SHALL let a `DOC_CREATE` user assign a budget to **every** line of a
budget-controlled document (`document_type.requires_budget`), item-backed or not, populating the
per-line budget selector from the selectable-budgets read (which returns `id`, `code`, `budgetName`,
`parentId`, the parent's `code` and `name`, and `glAccount`, and is itself authorized by
`DOC_CREATE`).

The selector was previously offered only on an item-less line, because an item-backed line had its
budget derived from the item's GL. That derivation is gone: one account is charged by several
budgets, so the account cannot choose between them and only the requester can. The selector SHALL be
shown for every line of a `requires_budget` type, and the line's derived GL account SHALL be shown
**beside** it as read-only context rather than in place of it — the two are different facts and the
screen SHALL NOT imply that either determines the other.

Selecting an item SHALL NOT clear a budget the requester has already named on that line. Clearing it
loses a deliberate choice to an unrelated edit, and leaves a line that the wizard's own coverage rule
then refuses to advance with nothing on screen to say what was lost.

Where the item's per-company GL (`item_company.default_gl_account`) is carried by **exactly one**
budget in the loaded selectable list, the wizard SHALL prefill the line's budget with it. Where the
account is carried by several budgets, or by none, the wizard SHALL leave the line's budget
unanswered for the requester to name. A prefilled budget SHALL remain editable through the same
selector, and SHALL be sent as an ordinary `budgetId` on save — this is a default offered on the
screen, not a derivation: the client stays the only party that names a budget, and the server
neither infers one from the line's account nor treats a prefilled value differently from a typed
one. Prefilling SHALL NOT stamp or alter the line's GL account.

The selector SHALL be filtered to the document's department and SHALL be searchable by code and by
name, because a requester in the largest department chooses among more than a hundred budgets and
speaks in codes. It SHALL show each option's `code` and `budgetName` together, since the code is
what the requester knows the budget by.

The affordance SHALL be shown to `DOC_CREATE` creators and SHALL NOT be gated on `BUDGET_VIEW`; a
creator without `BUDGET_VIEW` SHALL still be able to see and choose a budget. The selector SHALL
send the chosen `budgetId` on save, with the server remaining authoritative for reservation at
submit. The Budgets pages (balances, breakdown, ledger) remain gated by `BUDGET_VIEW` and are
unaffected.

#### Scenario: Creator without BUDGET_VIEW sees the budget selector

- **GIVEN** a signed-in user holding `DOC_CREATE` but not `BUDGET_VIEW`
- **WHEN** the user opens the Create wizard for a `requires_budget` document type and adds a line
- **THEN** that line offers a budget selector populated from the selectable-budgets read

#### Scenario: An item-backed line offers the selector too

- **GIVEN** a `requires_budget` document and a line referencing an item
- **WHEN** the wizard renders that line
- **THEN** a budget selector is offered, and the item's derived GL account is shown beside it as
  read-only

#### Scenario: Choosing a budget does not change the shown GL

- **GIVEN** an item-backed line showing a derived GL account
- **WHEN** the requester chooses a budget
- **THEN** the shown GL account is unchanged

#### Scenario: The selector is filtered to the document's department

- **WHEN** the creator opens the per-line budget selector
- **THEN** only budgets of the document's department are offered

#### Scenario: The selector can be searched by code

- **GIVEN** a department with more than a hundred budgets
- **WHEN** the creator types a budget code into the selector
- **THEN** the list narrows to the matching budgets

#### Scenario: Selected budget is sent on save

- **WHEN** the creator chooses a budget for a line and saves the draft
- **THEN** that line's `budgetId` is sent to the server

#### Scenario: A line left without a budget is surfaced before submit

- **GIVEN** a `requires_budget` document with a positive-amount line naming no budget
- **WHEN** the creator tries to submit
- **THEN** the wizard identifies that line as missing its budget rather than letting the submit be
  refused with no indication of which line is at fault

#### Scenario: Budget balances are not exposed by the selector

- **WHEN** the creator opens the per-line budget selector
- **THEN** each option shows only its code and name, and no budget amount or available balance

#### Scenario: A unique account match prefills the line's budget

- **GIVEN** a `requires_budget` document whose selectable list holds exactly one budget whose
  `glAccount` is `5001`
- **WHEN** the requester picks an item whose `item_company.default_gl_account` for the active company
  is `5001`
- **THEN** the line's budget selector is prefilled with that budget, the selector stays editable, and
  the line's GL account is unchanged

#### Scenario: An ambiguous account prefills nothing

- **GIVEN** a `requires_budget` document whose selectable list holds two budgets whose `glAccount` is
  `5000`
- **WHEN** the requester picks an item whose per-company GL is `5000`
- **THEN** the line's budget stays unanswered and the requester is asked to name one

#### Scenario: An unmatched account prefills nothing

- **GIVEN** a `requires_budget` document whose selectable list holds no budget carrying the item's
  per-company GL
- **WHEN** the requester picks that item
- **THEN** the line's budget stays unanswered and the requester is asked to name one

#### Scenario: Changing the item does not discard a named budget

- **GIVEN** a `requires_budget` line on which the requester has already chosen a budget
- **WHEN** the requester then selects or changes the line's item
- **THEN** the chosen budget is still selected and the line is not reported as missing a budget

#### Scenario: A prefilled budget can be overridden

- **GIVEN** a line whose budget was prefilled from the item's GL
- **WHEN** the requester picks a different budget from the selector
- **THEN** the line carries the budget the requester picked, and that `budgetId` is what is sent on
  save

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

### Requirement: Type-Driven Item and Budget Affordances in the Create Wizard

The Create Document wizard SHALL drive the line editor's budget and item affordances from the
selected document type's flags, mirroring the server (client validation is UX-only; the server
stays authoritative).

Budget affordances — the item-less fallback budget picker and the read-only resolved-budget
display — SHALL be shown only when the selected type has `requires_budget`. For a type without
`requires_budget`, no budget control SHALL appear on any line.

When the selected type has `requires_item`, the line item picker SHALL carry a visible required
indicator and expose `aria-required`, and the wizard SHALL block save and submit while any line
has no item, surfacing the reason inline on the offending line. When the type does not have
`requires_item`, the item remains optional as before.

For an item-less line on a `requires_budget` type, the wizard SHALL resolve the budget in the
same precedence as the server: an explicitly chosen budget wins; otherwise, when the type sets a
`default_gl_account` that matches a loaded selectable budget, the wizard SHALL show that resolved
budget read-only (like an item-backed line) and SHALL NOT require a manual pick; otherwise the
fallback picker SHALL be shown. The wizard SHALL flag — inline, before submit — a positive
item-less line only when no budget resolves for it (neither an explicit pick nor a type default).
Item-backed lines are not flagged client-side: the server derives and resolves their budget, or
rejects with a specific message that is surfaced verbatim.

#### Scenario: Budget control is hidden for a non-budget type

- **GIVEN** a selected document type without `requires_budget`
- **WHEN** the requester edits a line (with or without an item)
- **THEN** no budget picker and no resolved-budget display appear on the line

#### Scenario: Budget control appears for a budget-controlled type

- **GIVEN** a selected document type with `requires_budget` and no `default_gl_account`
- **WHEN** the requester adds a line with no item
- **THEN** the fallback budget picker is shown for that line; and selecting an item hides the
  picker and shows the resolved budget read-only

#### Scenario: Type default GL auto-resolves an item-less line's budget

- **GIVEN** a `requires_budget` type whose `default_gl_account` matches a loaded selectable
  budget
- **WHEN** the requester adds a line with no item
- **THEN** the resolved budget is shown read-only, the manual picker is not shown, and the line
  is not flagged for a missing budget

#### Scenario: Item-required type marks the item required and blocks an item-less line

- **GIVEN** a selected document type with `requires_item`
- **WHEN** the requester tries to save or submit with a line that has no item
- **THEN** the item field shows a required indicator, the save/submit is blocked, and an inline
  message identifies the line lacking an item

#### Scenario: Positive item-less line without a resolvable budget is flagged before submit

- **GIVEN** a `requires_budget` type with no `default_gl_account` (or whose default does not
  match a loaded budget)
- **WHEN** a line has a positive amount, no item, and no selected budget
- **THEN** the wizard flags that line inline and does not submit until a budget is chosen

#### Scenario: Item line trusts server budget resolution

- **GIVEN** a `requires_budget` type and a line that carries an item
- **WHEN** the requester submits
- **THEN** the client does not require a manually chosen budget for that line, and any server
  rejection (for example no active budget for the item's GL) is surfaced verbatim

### Requirement: Create Wizard Quota Reservation Step

When the selected document type has `requires_quota = true`, the Create Document wizard SHALL
present a quota-reservation step (shown only for such types, driven by configuration) that lets the
requester build one or more reservations before Review. Each reservation SHALL capture a `quotaId`
and a quantity, matching the server's `QuotaReservationInput`; the step SHALL NOT collect a
beneficiary employee — the server resolves a personal quota's beneficiary to the requester
themselves. The quota choices SHALL be read from the requester-facing selectable quota read
(`GET /quotas/selectable`, authorized by `DOC_CREATE`), so a requester without `QUOTA_VIEW` can
still build reservations. Each reservation's advisory remaining balance SHALL be shown as read-only
guidance, and a personal quota MAY indicate that the reservation applies to the requester; the
client SHALL treat the server as authoritative and never perform quota writes itself. Quantities
SHALL be entered and carried as strings formatted by the quota's unit and SHALL NOT be coerced to a
JavaScript number. The step SHALL support adding and removing reservations, each remove control
carrying an accessible label. The step SHALL NOT be completable until at least one reservation has a
positive quantity.

#### Scenario: Quota step appears only for quota-controlled types
- **WHEN** the user selects a document type with `requires_quota = true`
- **THEN** the wizard shows a quota-reservation step before Review
- **AND WHEN** the selected type has `requires_quota = false`
- **THEN** no quota step is shown

#### Scenario: Building a reservation from the selectable quotas
- **WHEN** the requester is on the quota step of a `requires_quota` document
- **THEN** the quota picker is populated from the requester-facing selectable quota read and the
  requester can add a reservation with a `quotaId` and a positive quantity, without choosing an
  employee

#### Scenario: Advisory remaining is shown without blocking
- **WHEN** a reservation selects a quota whose remaining balance is available
- **THEN** the step shows the advisory remaining for guidance and still lets the user submit, with
  the server remaining authoritative

#### Scenario: Quota step cannot be completed without a valid reservation
- **WHEN** a `requires_quota` document has no reservation with a positive quantity
- **THEN** the quota step is marked as failing with the reason surfaced inline and the wizard does
  not advance to Review

### Requirement: Payee Account Selector on Types That Require One

The web app SHALL show a payee bank account selector on the document form only when the document type's `requires_payee` is `true`, listing the active accounts of the document's selected vendor and defaulting to the vendor's primary account. The selector SHALL be disabled until a vendor is chosen, SHALL clear its value when the vendor changes, and SHALL mark the field required so the mirrored Zod schema fails the same submit the server would reject. Account numbers SHALL be rendered as text, never as a number, and the selector SHALL be read-only once the document has left `DRAFT`. The client guard is UX only; the server still enforces.

#### Scenario: The selector appears for a disbursement

- **GIVEN** a document type whose `requires_payee` is true
- **WHEN** a requester opens its form and picks a vendor
- **THEN** that vendor's active accounts are selectable, with the primary one preselected

#### Scenario: No selector on a type that needs no payee

- **WHEN** a requester opens the form of a type whose `requires_payee` is false
- **THEN** no payee account selector is shown, whatever its `post_action` is

#### Scenario: Changing the vendor clears the payee

- **GIVEN** a form with vendor A and one of its accounts selected
- **WHEN** the vendor is changed to B
- **THEN** the payee selection is cleared and only B's accounts are offered

#### Scenario: Submitting without a payee is caught client-side

- **GIVEN** a `requires_payee` form with no payee selected
- **WHEN** the requester submits
- **THEN** the form shows a required-field error and does not call the server

#### Scenario: The payee is read-only under approval

- **GIVEN** a disbursement in `IN_APPROVAL`
- **WHEN** an approver opens it
- **THEN** the payee account is shown but cannot be changed

### Requirement: Approvers See Where the Money Lands

The web app SHALL show the payee bank account — bank, account name, and account number — on the document detail of any document that carries one, so an approver can see the destination before approving rather than trusting it implicitly. The payee SHALL be shown to every user who can read the document, gated by no permission code beyond document read.

#### Scenario: The approver sees the destination

- **WHEN** an approver opens a disbursement awaiting their step
- **THEN** the bank, account name, and account number of the payee are shown

#### Scenario: The payee stays visible after the account is deactivated

- **GIVEN** an approved disbursement whose payee account was later deactivated
- **WHEN** the document detail is read
- **THEN** the original payee is still shown

### Requirement: Every Recorded Action Renders In The Detail Timeline

Every action the server can write to `approval_log` SHALL have a label in each supported locale, an
icon and a severity in the detail view's timeline. A row whose action the renderer does not
recognise SHALL NOT appear as an unlabelled entry: an unreadable history is worse than the silence
the record was added to remove.

A withdrawal SHALL render like any other act — its actor, when it happened, and its remark.

#### Scenario: A withdrawal appears in the timeline

- **GIVEN** a document whose history contains a `CANCEL` row
- **WHEN** the detail view renders
- **THEN** the timeline shows the withdrawal with its actor, time and remark, labelled in the
  active locale

#### Scenario: Every recorded action is labelled

- **WHEN** the timeline renders a history containing each action the server writes
- **THEN** none of the entries renders without a label

### Requirement: A Type Whose Authoring Screen This User Cannot Open Is Not Offered

Where a document type carries an `authoring_route`, the wizard SHALL determine whether the current
user may open that screen, and SHALL NOT let them choose the type when they may not. The
determination SHALL read the permission the destination route itself declares, so the card follows
the same guard that governs the screen.

Two unrelated things decide who sees the card and who may open the screen: the department mapping
decides the first, the route's permission decides the second. Nothing keeps them in step, so a user
can be offered a type whose screen refuses them — the navigation succeeds, the guard redirects them
away, and they arrive somewhere else with nothing said and nothing created. That is a worse outcome
than the dead-end it replaced, because it is immediate and silent: a user who does not know the
permission model cannot tell it from a misclick.

The required permission SHALL NOT be stored beside the document type. The route already declares it,
and a second copy is free to drift from the guard that enforces it.

An unreachable card SHALL be shown in a disabled state naming the permission required, rather than
hidden. A hidden card teaches nothing to a user who was told to raise that document and cannot find
it; a disabled one tells them what to ask for. The permission SHALL be named by its code, which is
what the system authorizes on and what an administrator can act on.

A disabled card SHALL remain reachable by keyboard and SHALL expose its disabled state to assistive
technology, so the reason can be read by every input method. Activating it SHALL do nothing.

When a type's `authoring_route` names a route that cannot be resolved, the type SHALL be treated as
reachable: the wizard keeps such a type in its own steps, so no other screen and no other permission
is involved.

A type with no `authoring_route` SHALL be unaffected — the wizard authors it, and the permissions
that govern it are the ones already checked for creating a document.

#### Scenario: A type whose screen the user cannot open is disabled

- **GIVEN** a document type routed to a screen whose permission the user does not hold
- **WHEN** the wizard renders its type cards
- **THEN** that card is shown disabled and names the permission required, and choosing it does
  nothing

#### Scenario: A type whose screen the user can open is offered normally

- **GIVEN** a routed document type whose destination permission the user holds
- **WHEN** the card is chosen
- **THEN** the wizard navigates to that screen as before

#### Scenario: An unresolvable route leaves the card enabled

- **GIVEN** a type whose `authoring_route` names no known route
- **WHEN** the wizard renders its type cards
- **THEN** the card is enabled, and choosing it advances the wizard's own steps

#### Scenario: A type the wizard authors itself is unaffected

- **GIVEN** a document type with no `authoring_route`
- **WHEN** the wizard renders its type cards
- **THEN** the card is enabled regardless of any screen's permissions

#### Scenario: The disabled card can still be read

- **WHEN** a keyboard user moves through the type cards
- **THEN** an unreachable card can be focused and reports itself as disabled, and activating it
  changes nothing

### Requirement: The Review Step Shows Every Value The Wizard Collected

The create wizard's review step SHALL present every document-level value the wizard asked the user
for, alongside the dynamic form fields and the lines it already shows. What is reviewed SHALL be
what is submitted.

Which values these are SHALL be derived from the same document-type configuration that decided
whether to ask for them — the flags governing budget, quota, vendor, payee, warehouse, destination
warehouse and related employee — rather than from a fixed list written into the review step. A
configuration flag that causes the wizard to collect a value therefore causes the review to display
it, and a value added later cannot be omitted by being forgotten here.

Where a required value has not been supplied, the review SHALL continue to mark it as missing.

#### Scenario: A stock document shows its warehouse

- **GIVEN** a document type requiring a warehouse, with one chosen in the wizard
- **WHEN** the review step renders
- **THEN** the chosen warehouse is shown

#### Scenario: An employee-bearing document shows its subject

- **GIVEN** a document type requiring a related employee, with one chosen in the wizard
- **WHEN** the review step renders
- **THEN** the chosen employee is shown

#### Scenario: A transfer shows both ends

- **GIVEN** a document type whose post action transfers stock, with a source and a destination chosen
- **WHEN** the review step renders
- **THEN** both warehouses are shown and are distinguishable

#### Scenario: A value the type does not ask for is not shown

- **GIVEN** a document type that requires no warehouse
- **WHEN** the review step renders
- **THEN** no warehouse is shown

### Requirement: The Line Editor Presents Budgets In The Structure They Have

The create wizard's budget control SHALL group the budgets it offers by the category their node
hangs under, using the category name the selectable read supplies, rather than presenting one flat
list ordered by code.

A department's budgets are a tree, and the leaves are named as if the branch were visible. Six
budgets reading `ງົບເດີນທາງ ພນ ບໍລິຫານ`, `… ພນ ບຸກຄະລາກອນ`, `… ພນ ມາດຕະຖານ` and so on differ by one
word and mean nothing apart; under their category, `ເງິນເດີນທາງ ໄປວຽກຕ່າງແຂວງ`, they are six
departments' travel budgets and the choice is obvious. The customer's largest department offers 92
such budgets in roughly 13 categories, and a requester scanning them flat is guessing.

Budgets whose node has no parent SHALL be offered under a single clearly-labelled group rather than
silently omitted or scattered.

The control SHALL remain filterable, and the filter SHALL match a category's name as well as a
budget's code and name, so typing a category narrows the list to its members. The filter input SHALL
carry a placeholder naming what can be typed — an unlabelled box beside a magnifier is the one
affordance that makes a long list usable, and it is invisible.

The control SHALL NOT display any budget amount, balance or ledger figure. The read behind it is
gated on `DOC_CREATE` rather than `BUDGET_VIEW` so a requester who may not read budget figures can
still raise a document; the grouping is what makes the choice legible without them.

#### Scenario: Budgets are grouped by their category

- **GIVEN** a department whose selectable budgets hang under several category nodes
- **WHEN** the requester opens the budget control on a line
- **THEN** the options appear under headings named for those categories, each budget under its own

#### Scenario: A category name distinguishes similarly-named budgets

- **GIVEN** several budgets whose names differ only by a trailing word, sharing one category
- **WHEN** the requester opens the budget control
- **THEN** they are shown together under that category's name

#### Scenario: A budget with no category is still offered

- **GIVEN** a selectable budget whose node has no parent
- **WHEN** the requester opens the budget control
- **THEN** it appears under a single labelled group for uncategorised budgets

#### Scenario: Typing a category narrows to its members

- **WHEN** the requester types a category's name into the control's filter
- **THEN** the budgets under that category are shown

#### Scenario: The filter says what it filters

- **WHEN** the budget control is opened
- **THEN** its filter input shows a placeholder describing what may be typed

#### Scenario: No figure is shown

- **WHEN** the budget control renders its options
- **THEN** no amount, balance or ledger figure appears for any budget

### Requirement: A Draft's Completeness Prompt Reads Each Field Where Its Value Lives

The draft-completeness prompt on a document SHALL determine whether a required field has a value by
reading where that field's TYPE stores its value, not by assuming every field stores it in
`doc_field_value`.

A `file` field's value is a `document_attachment` row. A `line_items` field's value is a
`document_line` row. Neither ever produces a `doc_field_value`, so a prompt that consults only that
table reports both as missing on every draft, whether or not the file was uploaded and the lines
were entered.

The server's submit gate already resolves presence per field type, and the prompt exists to predict
that gate's verdict. Where the two can disagree, they SHALL be driven from one shared rule rather
than from two hand-kept copies, so a field type added later cannot be handled in one and forgotten
in the other.

#### Scenario: An attached file is not reported missing

- **GIVEN** an editable draft whose template has a required `file` field, and an attachment uploaded
  against it
- **WHEN** the document detail renders
- **THEN** no completeness prompt names that field

#### Scenario: A genuinely missing file is reported

- **GIVEN** an editable draft whose template has a required `file` field and no attachment
- **WHEN** the document detail renders
- **THEN** the completeness prompt names that field

#### Scenario: Entered lines are not reported missing

- **GIVEN** an editable draft whose template has a required `line_items` field and at least one line
- **WHEN** the document detail renders
- **THEN** no completeness prompt names that field

#### Scenario: The prompt agrees with the submit gate

- **GIVEN** any editable draft
- **WHEN** the completeness prompt reports no missing field
- **THEN** the server's submit gate does not refuse the document for a missing required field

### Requirement: The Reason A Submit Was Refused Stays Readable

When a submit is refused, the screen SHALL keep the server's reason available for as long as the
document is still refused, and SHALL NOT leave a different, contradictory instruction as the only
message on screen.

A refusal delivered solely as a transient toast is gone in seconds, while a standing banner beside
it is not. A requester who looks away is then left with whatever the banner says — and acts on that
instead. Refusing an over-budget submit while the only visible text tells the reader to attach a
file they already attached sends them to fix the wrong thing and gives them no way back to the real
reason.

Where the refusal is one the requester can act on — an amount over its ceiling, a missing value, a
rate that does not resolve — the reason SHALL name what was wrong.

#### Scenario: An over-budget refusal is still readable afterwards

- **GIVEN** a draft whose amount exceeds its budget's ceiling
- **WHEN** the requester submits it and then waits
- **THEN** the reason the submit was refused is still on screen

#### Scenario: No contradictory instruction is left standing

- **WHEN** a submit is refused for a reason unrelated to missing fields
- **THEN** no completeness prompt claims a field is missing that is not

### Requirement: Print Dialog Offers This Document Or The Whole Set

The document detail screen's print action SHALL open a dialog offering exactly two choices —
this document only, or the whole reference chain (PR + PO + Receipt) — with this document only
preselected, plus a confirm and a cancel action. Confirming SHALL request the export with the
matching `parts` argument and download the returned PDF; cancelling SHALL request nothing. The
action SHALL remain gated on the same permission that gates it today, SHALL show progress while
the export runs, and SHALL surface a failed export as a message without downloading anything.
The chain choice SHALL be offered whether or not the document has a predecessor, because a
document's successors are not visible from it and the server decides what the set contains.

#### Scenario: Printing only the open document

- **GIVEN** a user on a completed document's detail screen
- **WHEN** they open the print dialog, keep the preselected choice and confirm
- **THEN** the export is requested for that document alone and the PDF is downloaded

#### Scenario: Printing the whole set

- **GIVEN** the same screen
- **WHEN** the user selects the whole-set choice and confirms
- **THEN** the export is requested for the reference chain and the returned PDF is downloaded

#### Scenario: Cancelling asks for nothing

- **WHEN** the user opens the print dialog and cancels
- **THEN** no export is requested and no file is downloaded

#### Scenario: A failed export is reported, not downloaded

- **GIVEN** an export request that fails
- **WHEN** the user confirms the dialog
- **THEN** an error message is shown and no file is downloaded

#### Scenario: The print action stays permission-gated

- **GIVEN** a user without the permission that gates the export
- **WHEN** they open a document's detail screen
- **THEN** the print action is not offered

### Requirement: The Attachment Picker Accepts Only Printable Evidence

The attachment picker on the document screens SHALL offer only PDF, JPEG and PNG files, mirroring
the server's allow-list so the client and the server do not drift, and SHALL explain a rejected
file by naming the accepted types rather than reporting a bare failure. The client check is a
convenience: the server remains the enforcement point. Attachments already stored outside the
accepted types SHALL still be listed and downloadable from the detail screen.

#### Scenario: The picker offers the accepted types

- **WHEN** a user opens the attachment picker
- **THEN** it offers PDF, JPEG and PNG files

#### Scenario: A rejected file says what is accepted

- **WHEN** a user selects a file of an unaccepted type
- **THEN** a message names PDF, JPEG and PNG as the accepted types and no upload is attempted

#### Scenario: An older attachment remains readable

- **GIVEN** a document carrying an attachment of a type no longer accepted
- **WHEN** the user opens the detail screen
- **THEN** the attachment is listed and can still be downloaded


### Requirement: A Submit Refused For An Unresolvable Account Names The Line And Where To Set One

When a submit is refused because a line resolves no expense account, the screen SHALL name the line
and SHALL say that an account may be set on the item, on the document type, or on the budget.

Naming only the budget sends the reader to one of three places, and usually the wrong one: a line
with an item takes its account from the item and never reads the budget at all. Which of the three
to fill in depends on what the line is, so the refusal has to offer all three rather than choose.

The refusal SHALL be surfaced with the existing refusal treatment, so it stays readable rather than
passing as a toast, and SHALL NOT be reported as a missing form field — no field on the form carries
this value, and sending the requester back into the wizard is a dead end.

Where the requester cannot set any of the three themselves, the refusal SHALL say which permission
can, rather than instructing them to perform an action their permissions forbid.

#### Scenario: The refusal names the line and the three sources

- **GIVEN** a draft whose line 1 resolves no account
- **WHEN** the requester submits it
- **THEN** the screen shows the refusal naming line 1 and the item, document type and budget as the
  places an account can be set

#### Scenario: The refusal outlives a toast

- **GIVEN** the refusal above
- **WHEN** the requester waits and looks back at the screen
- **THEN** the reason is still readable

#### Scenario: The refusal is not dressed as a missing field

- **WHEN** a submit is refused because a line resolves no account
- **THEN** no completeness prompt claims a form field is missing, and no action offers to reopen the
  wizard to fill one in

### Requirement: Create Successor Is Offered Only For An Open Pairing

On the document detail screen the create-successor affordance SHALL offer only successor types
for which the document has no live successor, as reported by the detail's `successors` list. When
every configured pairing is taken the affordance SHALL be hidden. The screen SHALL show each live
successor as a link to that document with its `doc_no` and status, so a user who cannot create a
`PO` can see the one that exists. A server refusal (400 already-exists or 409 lost the race) SHALL
be surfaced as an error and the detail re-read so the new successor appears. The client rule is
UX only; the server still enforces.

#### Scenario: A taken pairing is not offered
- **GIVEN** an `APPROVED` `PR` whose detail lists a live `PO`
- **WHEN** a `DOC_CREATE` user views it
- **THEN** `PO` is not offered as a successor type and the existing `PO` is shown as a link

#### Scenario: A freed pairing is offered again
- **GIVEN** a `PR` whose only `PO` is `CANCELLED`
- **WHEN** the user views the `PR`
- **THEN** `PO` is offered as a successor type

#### Scenario: Losing the race is surfaced
- **GIVEN** a user whose create-from is refused by the server because a successor now exists
- **WHEN** the refusal arrives
- **THEN** the error is shown and the detail re-reads, listing the successor that won

### Requirement: An Inherited Budget Stays Selectable On A Draft

When the create wizard edits an existing draft, it SHALL request the selectable-budgets read
naming that draft, so the budgets its lines already carry are offered back. A line whose budget
came with the document SHALL NOT be reported as "budget unavailable" and SHALL NOT block the
step. Inherited budgets SHALL be shown in their own group, labelled as coming with the document,
ahead of the requester's own budgets, so the requester can tell them from budgets they may freely
choose among.

#### Scenario: Procurement completes a PO raised from ADM's PR

- **GIVEN** a PO draft created from an ADM PR, carrying ADM's budget on its line, opened by a Procurement user whose own picker does not offer that budget
- **WHEN** the line editor renders
- **THEN** the line shows ADM's budget selected, no "unavailable" message, and the step may proceed

#### Scenario: Inherited budgets are grouped and labelled

- **WHEN** the picker offers an inherited budget
- **THEN** it appears under a group labelled as coming with the document, before the requester's own groups

#### Scenario: A new draft asks for nothing extra

- **WHEN** the wizard creates a new document rather than editing one
- **THEN** the selectable-budgets read is requested without a document id
