## MODIFIED Requirements

### Requirement: Document List and Detail

The web app SHALL show the active company's documents (with status) to users holding
`DOC_VIEW`, and a detail view with the document's header, field values, line items,
attachments, approval log, and — when present — its predecessor reference (the source
document's `doc_no`, linked). When the document carries a currency and a locked exchange rate, the
detail SHALL present the document currency, the locked rate, the base-currency label, the base total
and line base amounts, and the lock date (the submit date); monetary amounts SHALL be formatted using
the relevant currency's `decimal_places`.

Those base-currency figures belong to a submission, and SHALL NOT be presented while the document is
`DRAFT` — neither on the detail nor in the list's base-currency column, which SHALL use its existing
empty state for such a row. `document.exchange_rate` and `document.base_total_amount` are written
only at submit, and `exchange_rate` carries a default of 1 from creation, so a draft either has never
had them computed or holds the ones a submission that was later returned left behind. Showing them
states a locked rate for a document that has locked nothing: a draft corrected from the company base
to a foreign currency displayed its old identity rate of 1.00 and its old base total beside the new
currency, asserting a 1:1 conversion that was wrong by nearly three orders of magnitude, to the
author who had just made the correction and was reading the screen to see whether it took. The detail SHALL show the document's vendor (when present)
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

#### Scenario: A draft states no locked rate

- **GIVEN** a `DRAFT` document in a currency other than the company base
- **WHEN** the user opens its detail
- **THEN** no base-currency total, locked rate or lock date is shown

#### Scenario: A returned draft does not keep the figures of its withdrawn submission

- **GIVEN** a foreign-currency document returned to `DRAFT` by an approver, carrying the rate and
  base total stamped at that submission
- **WHEN** the user opens its detail
- **THEN** neither the stamped rate nor the stamped base total is shown

#### Scenario: The list shows no base total for a draft

- **GIVEN** a `DRAFT` document
- **WHEN** the user views the documents list
- **THEN** its base-currency column shows the empty state rather than a figure

#### Scenario: Submitting restores the figures

- **GIVEN** a `DRAFT` document whose currency was corrected
- **WHEN** it is submitted
- **THEN** the detail shows the rate and base total stamped at that submit
