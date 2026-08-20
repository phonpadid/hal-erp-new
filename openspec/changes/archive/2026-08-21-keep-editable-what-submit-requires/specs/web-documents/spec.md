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

The pickers for the selections the TYPE asks for — warehouse, destination warehouse, related
employee and vendor — SHALL remain usable while the document is a draft, and the choice SHALL be
persisted on save. These are not field values and not lines, so the promise above does not reach
them; they were write-once at creation, and a draft lacking one showed it blank, disabled and
required at the same time, with the step refusing to advance and nothing the user could do about it.
A draft whose type gained `requires_warehouse` or `requires_employee` after it was created is in
exactly that state through no act of its author. The pickers SHALL offer the same company-scoped,
active/enabled records the create wizard offers, and SHALL be disabled once the document has left
`DRAFT`, where the server refuses the change.

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
