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
