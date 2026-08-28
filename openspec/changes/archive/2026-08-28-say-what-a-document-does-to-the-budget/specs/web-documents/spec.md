## MODIFIED Requirements

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
