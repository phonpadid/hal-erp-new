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
optional item picker populated only from the items enabled for the active company; selecting an item
SHALL display that item's default GL account on the line as read-only (auto-filled, not editable)
and SHALL send the line's `itemId` on save, with the server remaining authoritative for the GL
default. Vendor and item selection are optional; when no item is selected the line's GL is shown as
empty.

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

#### Scenario: Picking an item auto-fills its GL account read-only

- **WHEN** the user selects an item (from the company-enabled items) on a line
- **THEN** the line shows that item's default GL account as a read-only value and sends the line's
  `itemId` on save, without sending an explicit GL account

#### Scenario: Item without a default GL shows no account

- **WHEN** the user selects an item that has no default GL account
- **THEN** the line's GL is shown as empty and the item is still saved on the line

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
