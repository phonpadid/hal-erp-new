## MODIFIED Requirements

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

The currency SHALL be sent on save from the EDIT path as well as the create path. It is not a field
value and not a line, so the promise that reopening a draft restores and re-saves what it holds does
not reach it on its own — and a picker that is offered, recomputes the totals beside it and reports a
successful save while discarding what was chosen is worse than one that was never offered. Where the
save is assembled from a list of header values, the edit path SHALL derive its payload from that same
list rather than restating it, so a value added for one path cannot be missing from the other. The
currency picker SHALL be disabled once the document has left `DRAFT`, where the server refuses the
change.

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
employee and vendor — and the currency picker SHALL remain usable while the document is a draft, and
the choice SHALL be persisted on save. These are not field values and not lines, so the promise above does not reach
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

#### Scenario: A reopened draft's currency change is saved

- **GIVEN** a `DRAFT` document reopened for editing
- **WHEN** the user changes the currency picker to another active currency and saves the draft
- **THEN** the chosen currency is sent to the server and the reloaded document carries it

#### Scenario: A currency change is not reported as saved unless it was sent

- **GIVEN** a `DRAFT` document reopened for editing
- **WHEN** the save request carrying the currency is refused by the server
- **THEN** the failure is surfaced to the user and no success confirmation is shown

#### Scenario: A submitted document's currency is not offered for editing

- **WHEN** a user opens a document that has left `DRAFT`
- **THEN** the currency picker is disabled
