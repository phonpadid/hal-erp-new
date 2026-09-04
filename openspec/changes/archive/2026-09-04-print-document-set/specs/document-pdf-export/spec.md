## MODIFIED Requirements

### Requirement: Export Document as PDF

The system SHALL expose an authenticated endpoint that renders a document as a PDF,
identified by document id in the path. Access SHALL require the same read authorization
and active-company scope as reading the document itself: a caller who may read the
document MAY export it, and the export SHALL NOT reveal any document the caller could not
already read. The sheet layouts SHALL be selected by the document type's `print_templates`
(see `The Printed Sheets Are Selected By Configuration`); a type configured `LETTER` — the
default — SHALL render the Lao official-letter layout (ໃບສະເໜີ): a Lao national header, the
issuing company's logo and name, the document number (`doc_no`) as ເລກທີ and the document
`created_at` as ວັນທີ, a proposer identity line drawn from the document's employee, and the
document's configured form field values as the letter body. Every layout SHALL include the
approval trail and the per-step signature blocks. The endpoint SHALL accept a `parts`
argument selecting whether it renders the requested document alone or its whole reference
chain, defaulting to the requested document alone. The endpoint SHALL stream the generated
PDF rather than persisting it as a stored attachment. All company data rendered (logo, name)
SHALL come only from the document's own `company`, so no other company's data is disclosed.

#### Scenario: Authorized caller exports an approved document

- **GIVEN** a user authorized to read a COMPLETED document in the active company whose type is
  configured `LETTER`
- **WHEN** they request its PDF export
- **THEN** a PDF is returned in the Lao letter layout containing the company header, the
  document number and date, the proposer line, the configured form body, and the approval
  trail

#### Scenario: Export honors company isolation

- **GIVEN** a document belonging to company B
- **WHEN** a user whose active company is A and who has no GROUP-scope read right requests its PDF
- **THEN** the request is denied and no document content is disclosed

#### Scenario: Non-completed document is watermarked

- **GIVEN** a document that is DRAFT or IN_APPROVAL
- **WHEN** an authorized caller exports it
- **THEN** the PDF is produced and marked as not fully approved (e.g. a "DRAFT" watermark)

#### Scenario: An export that names no parts renders the requested document alone

- **GIVEN** a document that has a predecessor
- **WHEN** an authorized caller exports it without naming a `parts` argument
- **THEN** the PDF contains that document's sheet only, exactly as it did before this change

## ADDED Requirements

### Requirement: The Printed Sheets Are Selected By Configuration

The renderer SHALL choose a document's sheet layouts from its `document_type.print_templates`
value — an ordered list of one to four sheets — and SHALL NOT branch on the type's `code`,
`category`, or `post_action` (invariant 7): two companies may spell the same business document with
different codes, and one company may run several purchase-request types. A type declaring several
sheets SHALL print each of them, in print order (`LETTER`, `PR`, `PO`, `RECEIPT`), one after the
other for that one document: a purchase request filed as the official letter AND as the
purchase-request form is one document that is two pieces of paper. A type whose list contains
`LETTER` SHALL render the official-letter layout for that entry, and the requirements `Lao National Header Block`, `Company Logo and Name
Header`, `Document Number and Date Fields`, `Proposer Identity Line` and `Letter Body from
Configured Form Fields` SHALL apply to that layout only. The requirements `Lao-Script Font
Rendering`, `Configurable Per-Step Signature Blocks` and `Embed Stamped Approver Signatures in
the PDF` SHALL apply to every layout.

#### Scenario: A type configured PR prints the purchase-request sheet

- **GIVEN** a document type whose `print_templates` is `PR`
- **WHEN** a document of that type is exported
- **THEN** the PDF is the purchase-request sheet, not the official letter

#### Scenario: One document prints as several sheets

- **GIVEN** a document type whose `print_templates` is `LETTER,PR`
- **WHEN** a document of that type is exported
- **THEN** the PDF contains the official letter followed by the purchase-request sheet, in that
  order, for that single document

#### Scenario: A type that configures no template still prints the letter

- **GIVEN** a document type whose `print_templates` is unset
- **WHEN** a document of that type is exported
- **THEN** the PDF is the official-letter layout, unchanged from before this change

#### Scenario: Two companies spelling a code differently print by configuration

- **GIVEN** company A whose purchase-request type has code `PR` and company B whose equivalent
  type has code `REQ`, both configured `print_templates = PR`
- **WHEN** a document of each is exported
- **THEN** both render the purchase-request sheet

### Requirement: Purchase-Request, Purchase-Order and Receipt Sheets

The system SHALL render three sheet layouts in addition to the letter, each a Lao/English
bilingual form headed by the document number:

- `PR` (ໃບສະເໜີຈັດຊື້): the requester's name, position and department; the document's
  `created_at` as the request date and its configured expected/required date; the purpose; a
  line table of number, description, quantity, unit, unit price and line amount; and the grand
  total with its currency.
- `PO` (ໃບສັ່ງຊື້): the `PR` content plus the vendor's name and contact, the approved payee bank
  account, the budget name and code carried by the document's lines, and a total block of
  subtotal, tax and grand total.
- `RECEIPT` (ໃບເບີກຈ່າຍ): the `PO` content plus the GL account the lines resolve to, the
  predecessor document's number, and a per-line remark column.

Each sheet SHALL render only data the document actually carries; a field the document does not
carry SHALL render blank and SHALL NOT fail the export. Every amount SHALL be formatted with its
currency's `decimal_places` and SHALL be carried as a decimal string, never a floating-point
number.

#### Scenario: A receipt names the order it settles

- **GIVEN** a `RECEIPT` document created from a purchase order
- **WHEN** it is exported
- **THEN** the sheet shows the predecessor purchase order's `doc_no`

#### Scenario: A missing optional field leaves a blank

- **GIVEN** a `PO` document whose vendor has no recorded contact number
- **WHEN** it is exported
- **THEN** the contact cell renders blank and the export succeeds

#### Scenario: Amounts follow the currency's decimal places

- **GIVEN** a document in a currency with `decimal_places` of 0
- **WHEN** it is exported
- **THEN** every amount is printed with no decimal digits

### Requirement: Printing a Document Set Along the Reference Chain

When the export names `parts=CHAIN`, the system SHALL follow `document.ref_document` from the
requested document to the root of its reference chain and render every document found, ordered
predecessor-first (PR, then PO, then Receipt), each starting on a new page and each using its own
type's `print_templates`. Only documents the caller may read in the active company SHALL be
included; a document of another company or one outside the caller's read scope SHALL be omitted
rather than fetched, and its absence SHALL NOT fail the export (invariant 1). A document with no
predecessor SHALL produce the same PDF as `parts=SELF`. The walk SHALL be bounded so a cyclic or
pathological chain cannot produce an unbounded document.

#### Scenario: A completed purchase prints as one set

- **GIVEN** a receipt whose predecessor is a purchase order whose predecessor is a purchase request
- **WHEN** an authorized caller exports the receipt with `parts=CHAIN`
- **THEN** one PDF is returned containing the purchase-request sheet, then the purchase-order
  sheet, then the receipt sheet, each on its own page

#### Scenario: A chain missing a middle document prints what exists

- **GIVEN** a receipt created directly from a purchase request, with no purchase order
- **WHEN** it is exported with `parts=CHAIN`
- **THEN** the PDF contains the purchase-request sheet and the receipt sheet, and nothing stands
  in for the absent purchase order

#### Scenario: A predecessor the caller may not read is left out

- **GIVEN** a document whose predecessor lies outside the caller's read scope
- **WHEN** the caller exports it with `parts=CHAIN`
- **THEN** the PDF contains only the documents the caller may read, and no content of the
  predecessor is disclosed

#### Scenario: A document with no predecessor prints alone

- **GIVEN** a purchase request that starts its own chain
- **WHEN** it is exported with `parts=CHAIN`
- **THEN** the PDF contains that document's sheet only

### Requirement: Attached Evidence Is Printed With the Document

The export SHALL append every attachment of each printed document after that document's sheets. A
`application/pdf` attachment SHALL be merged page-for-page, keeping the pages its own author laid
out. `image/jpeg` and `image/png` attachments SHALL be printed several to a page, scaled to fit
without distortion, so that a set of photographed slips does not become a sheet of paper each; a
page holding a single wide image MAY be turned to landscape to use the sheet. An attachment of any
other type — only possible for files stored before the upload allow-list narrowed — SHALL produce a
single page naming the file and stating that its type cannot be printed. Attachments SHALL be read
only within the active-company scope, and SHALL be printed in the order they were filed.

Attachment bytes are supplied by users and SHALL be treated as untrusted input: merged PDF pages
SHALL be stripped of document-level JavaScript, open actions, embedded files and annotations. A
file that cannot be parsed, is encrypted, or exceeds the configured page or size ceiling SHALL
produce a page naming it and the reason, and the export SHALL still succeed.

#### Scenario: A transfer slip prints behind the document that carries it

- **GIVEN** a completed document with a JPEG transfer slip attached
- **WHEN** it is exported
- **THEN** the PDF contains the document's sheet followed by a page holding the slip image

#### Scenario: Photographed slips share a page

- **GIVEN** a document carrying two image attachments
- **WHEN** it is exported
- **THEN** both are printed on one page rather than on a page each

#### Scenario: A multi-page PDF attachment keeps all its pages

- **GIVEN** a document with a three-page PDF quotation attached
- **WHEN** it is exported
- **THEN** all three pages appear in the exported PDF in their original order

#### Scenario: A PDF between two images keeps the filed order

- **GIVEN** a document carrying an image, then a PDF, then another image
- **WHEN** it is exported
- **THEN** the pages appear in that order, and the two images do not share a page across the PDF

#### Scenario: A corrupt attachment does not fail the export

- **GIVEN** a document with an attachment whose bytes are not a readable PDF
- **WHEN** it is exported
- **THEN** a page names the file and states it could not be printed, and the rest of the PDF is
  produced normally

#### Scenario: Active content in an attached PDF is not carried into the export

- **GIVEN** an attached PDF carrying an embedded JavaScript action
- **WHEN** it is merged into the export
- **THEN** the merged pages carry no JavaScript, open action, embedded file or annotation

#### Scenario: A chain export carries each document's own evidence

- **GIVEN** a chain export where both the purchase order and the receipt have attachments
- **WHEN** the set is exported
- **THEN** each document's attachments appear after that document's own sheet, not pooled at the
  end

### Requirement: Printed Evidence Says Which Kind It Is

Every printed image SHALL be captioned in place with the document number, the kind of evidence it
is — the request's own attachment, or payment evidence — and its file name; every merged or
generated page SHALL carry the same three facts in its footer stamp. A reader holding one loose
page SHALL be able to tell a supporting document from proof that money moved without opening the
system.

The export SHALL NOT produce a page whose only content is a list of the file names that follow.
Naming each file where it is printed says the same thing without spending a sheet of paper on it.

#### Scenario: A slip and an attachment are told apart where they are printed

- **GIVEN** a document carrying both an attachment and a payment slip
- **WHEN** an authorized caller who may read both exports it
- **THEN** each image carries a caption naming its document, its kind and its file name

#### Scenario: No page is spent listing file names

- **GIVEN** a document carrying several attachments
- **WHEN** it is exported
- **THEN** the evidence pages follow the document's sheet directly, and no page holds only a list
  of their names

### Requirement: A Document With No Recorded Route Signs From Its Approval Log

The system SHALL derive a document's signature blocks from its `approval_log` APPROVE entries, in
step order and with the same rules for the stamped signature image, when that document has no
recorded route at all — the state of every document approved before routes were recorded. When a
route IS recorded, the recorded steps SHALL remain the only source, and a route whose steps are all
flagged off SHALL keep producing no blocks: that is a configuration decision, not missing data.

#### Scenario: An older approved document still shows who approved it

- **GIVEN** a COMPLETED document with approval-log entries and no `document_approval_step` rows
- **WHEN** it is exported
- **THEN** one signature block per APPROVE entry is rendered, in step order, naming the approver

#### Scenario: A route that prints no signatures still prints none

- **GIVEN** a document whose recorded route has every step flagged `show_signature_on_pdf` off
- **WHEN** it is exported
- **THEN** no signature block is rendered, and the approval log is not used as a fallback

#### Scenario: A block without a signature on file leaves a line to sign

- **GIVEN** a signature block whose approver has no stamped signature
- **WHEN** the sheet is rendered
- **THEN** the block shows the approver's name over a ruled line rather than an empty space

### Requirement: Payment Slips Are Printed Only for a Caller Who May Read Them

Payment evidence (`payment_attachment`) SHALL be appended to the export only for a caller holding
`PAYMENT_VIEW`; for any other caller the slips SHALL be omitted entirely and SHALL NOT be named on
the separator page. Printing SHALL NOT become a way to read evidence the caller could not read on
the payment itself.

#### Scenario: A finance user's export carries the slips

- **GIVEN** a completed document with a recorded payment carrying two slips
- **WHEN** a caller holding `DOC_VIEW` and `PAYMENT_VIEW` exports it
- **THEN** both slips are appended to the PDF

#### Scenario: A requester's export carries none of them

- **GIVEN** the same document
- **WHEN** a caller holding `DOC_VIEW` but not `PAYMENT_VIEW` exports it
- **THEN** the PDF contains the document's own attachments only, and neither the slips nor their
  file names appear anywhere in it
