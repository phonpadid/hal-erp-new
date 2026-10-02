# Document PDF Export Specification

## Purpose
Server-side PDF generation of a document together with its approval trail. The export
honours the same read authorization and active-company scope as reading the document,
renders configurable per-step signature blocks driven by
`workflow_step.show_signature_on_pdf`, and embeds each approver's signature as stamped
onto `approval_log` at approval time — never the approver's later current signature.
## Requirements
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

#### Scenario: Non-completed document prints without a watermark

- **GIVEN** a document that is DRAFT or IN_APPROVAL
- **WHEN** an authorized caller exports it
- **THEN** the PDF is produced with no "DRAFT" watermark, and a step not yet approved prints
  its signature block without a signature

#### Scenario: An export that names no parts renders the requested document alone

- **GIVEN** a document that has a predecessor
- **WHEN** an authorized caller exports it without naming a `parts` argument
- **THEN** the PDF contains that document's sheet only, exactly as it did before this change

### Requirement: Configurable Per-Step Signature Blocks

The number and identity of approver signature blocks on the exported PDF SHALL be driven by the
`show_signature_on_pdf` flag **recorded on the document's own route** at submit: the PDF SHALL
render a signature block for each recorded step flagged on, in `step_no` order, and SHALL NOT
render one for a step flagged off. Because a block exists only per recorded step, the number of
approver signature blocks SHALL always be `<=` the number of steps the document actually routed
through. This configuration SHALL NOT change how documents are routed or approved — it only
controls PDF output.

Each block SHALL be headed by the capacity in which it was signed, not the position of the step in
the route: once the step has an APPROVE entry, the heading SHALL be the approver's `employee`
`position` (resolved in the document's own company); an approver with no employee row or no
`position` falls back to the recorded `step_name`, else the step number. The department name SHALL
NOT be part of the heading — with it the heading ran to two long Lao lines per column and the row
could not hold them. A block whose step has not yet been approved SHALL be headed by the recorded
`step_name` when one is configured, else by its step number (ຂັ້ນທີ N). A reader of the sheet is
asking "who signed, as what" — a heading of "step 3" answers neither.

The signature row SHALL hold at most five columns; a longer row SHALL wrap to further rows of the
same column width, in order, and the rows SHALL be kept together on one page. Every column SHALL
have the same fixed width, sized for a full row, so a stamped image or a Lao title with no space
to wrap at cannot widen its column and push the row off the page. The layout SHALL hold at least
ten signatures (the proposer and nine approvers) on A4.

Re-exporting a document SHALL produce the same sheet it produced before, whatever has since been
done to the workflow it was routed by. A sheet that was printed and signed by hand is evidence, and
evidence that changes when a configuration is edited is not evidence — the same argument
`payment-batch` makes for storing the exact bytes sent to a bank.

#### Scenario: Only flagged steps produce signature blocks

- **GIVEN** a 3-step route with steps 1 and 3 flagged `show_signature_on_pdf` and step 2 not
- **WHEN** the document PDF is exported
- **THEN** the PDF shows exactly two approver signature blocks, for steps 1 and 3, and none for
  step 2

#### Scenario: Signature block count never exceeds step count

- **GIVEN** any document
- **WHEN** it is exported
- **THEN** the number of approver signature blocks is at most the number of steps on its recorded
  route

#### Scenario: An approved block is headed by the approver's position

- **GIVEN** a step approved by a user whose employee row in the document's company has department
  "ບັນຊີ" and position "ຫົວໜ້າພະແນກ"
- **WHEN** the document is exported
- **THEN** that block's heading reads "ຫົວໜ້າພະແນກ" — the position alone, not the department, the
  step name or the step number

#### Scenario: Columns follow the step order however the route rows were stored

- **GIVEN** a document whose recorded route rows were written in the order 1, 6, 7, 2, 3, 4
- **WHEN** it is exported
- **THEN** the approver blocks appear as steps 1, 2, 3, 4, 6, 7 — the order people sign in

#### Scenario: Ten signatures print as two rows of five

- **GIVEN** a submitted document whose recorded route has nine steps flagged `show_signature_on_pdf`
- **WHEN** it is exported
- **THEN** the signature row shows the proposer and the first four steps on one row and the
  remaining five on a second row of equal column widths, all within the page width

#### Scenario: A lone column on a second row is as wide as the others

- **GIVEN** a document with six signature blocks in all
- **WHEN** it is exported
- **THEN** the second row holds one column of the same width as the five above it

#### Scenario: A pending block keeps the configured step name

- **GIVEN** an in-progress document whose unapproved step has `step_name` "ຜູ້ອຳນວຍການ"
- **WHEN** it is exported
- **THEN** that block is headed "ຜູ້ອຳນວຍການ" over an empty line

#### Scenario: A pending block with no step name is headed by its number

- **GIVEN** an in-progress document whose unapproved step 2 has an empty `step_name`
- **WHEN** it is exported
- **THEN** that block is headed ຂັ້ນທີ 2

#### Scenario: An issued sheet does not change when the workflow does

- **GIVEN** an approved document whose PDF has been exported
- **WHEN** the workflow it routed through gains a step, loses one, or has a step renamed or
  re-flagged
- **THEN** re-exporting that document produces the same blocks, in the same order

#### Scenario: Flag does not affect approval routing

- **GIVEN** a step flagged off for the PDF
- **WHEN** the document routes through that step
- **THEN** the step is still approved normally and only its appearance on the PDF is suppressed

### Requirement: Embed Stamped Approver Signatures in the PDF

The PDF SHALL render, for each approver signature block (a step flagged `show_signature_on_pdf`)
that has an APPROVE entry, the approver's name, the acted-at timestamp, and — when the
`approval_log.signature_id` is present — the signature image referenced by that snapshot,
fetched server-side from object storage. The rendered signature SHALL be the one
stamped at approval time, never the approver's later current signature. When the APPROVE
entry has no stamped signature (a row written before approval required one, or a step flagged
off at the time), the block SHALL show the approver name and timestamp with a
"signature not on file" placeholder. When a flagged step has not yet been approved (export
of an in-progress document), the block SHALL render empty with only its heading. The
export SHALL still succeed in all these cases.

#### Scenario: Each approval shows the signature used at approval time

- **GIVEN** a document approved across two steps, each approver having a stamped signature
- **WHEN** the PDF is exported
- **THEN** each step shows that approver's name, timestamp, and the exact signature image
  referenced by its `approval_log.signature_id`

#### Scenario: Signature replaced after approval does not change the PDF

- **GIVEN** an approval that stamped signature S1
- **WHEN** the approver later replaces their signature with S2 and the PDF is exported again
- **THEN** the exported PDF still shows S1 for that approval step

#### Scenario: A historical approval without a signature still renders

- **GIVEN** an APPROVE entry whose `signature_id` is null
- **WHEN** the PDF is exported
- **THEN** that step shows the approver name and timestamp with a signature placeholder and
  the export still succeeds

#### Scenario: Reject and return entries carry no signature

- **GIVEN** a trail containing a REJECT or RETURN action
- **WHEN** the PDF is exported
- **THEN** those entries show the actor and timestamp but no signature image

### Requirement: Lao National Header Block

The exported PDF SHALL render a fixed Lao national header block at the top of the document,
above the company header: the state name line (ສາທາລະນະລັດ ປະຊາທິປະໄຕ ປະຊາຊົນລາວ), the motto
line (ສັນຕິພາບ ເອກະລາດ ປະຊາທິປະໄຕ ເອກະພາບ ວັດທະນະຖາວອນ), and a centred separator (‑‑‑000‑‑‑).
This block is constant and SHALL NOT depend on document content.

#### Scenario: National header appears on every export

- **WHEN** any document is exported
- **THEN** the PDF's first block is the Lao state name, the motto line, and the ‑‑‑000‑‑‑
  separator, centred

### Requirement: Company Logo and Name Header

The exported PDF SHALL render the issuing company's logo and name below the national header,
laid out as the company's paper form lays them out:
- the logo and the company name SHALL form one block at the left margin, with the logo directly
  above the name and centred over it;
- the company name SHALL start at the left margin, on the same row as the ເລກທີ field, which is
  right-aligned.

The logo SHALL be the image at the document's `company.profile_image_path`, fetched server-side
from object storage. When the company has no `profile_image_path`, or the object cannot be fetched,
the logo SHALL be omitted, the name row SHALL follow the national header directly, and the export
SHALL still succeed. The company name SHALL be `company.name_th`.

#### Scenario: Company with a logo shows its logo and name

- **GIVEN** a document whose company has a `profile_image_path`
- **WHEN** the PDF is exported
- **THEN** the PDF shows that company's logo image and its `name_th`

#### Scenario: The logo sits centred over the name, and the name is on the number row

- **GIVEN** a document whose company has a logo
- **WHEN** the letter is exported
- **THEN** the logo is directly above the company name, and its horizontal centre is the centre of
  the printed name
- **AND** the company name starts at the left margin, at the same height as ເລກທີ

#### Scenario: Company without a logo still exports

- **GIVEN** a document whose company has no `profile_image_path`
- **WHEN** the PDF is exported
- **THEN** the company name is shown, no logo image is rendered, and the export succeeds

### Requirement: Document Number and Date Fields

The exported PDF SHALL show, in the header area, a ເລກທີ field bound to the document's `doc_no`,
right-aligned on the company-name row. Below it, also right-aligned, it SHALL show the date line
`ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ {date}`, where the date is the document's `created_at` rendered as a
date.

The place of issue (`ນະຄອນຫຼວງວຽງຈັນ`) SHALL be fixed letter text, like the salutation and the
closing, and SHALL NOT be read from company data.

#### Scenario: Number and date reflect the document

- **GIVEN** a document with a `doc_no` and a `created_at`
- **WHEN** the PDF is exported
- **THEN** ເລກທີ shows the `doc_no` and ວັນທີ shows the `created_at` formatted as a date

#### Scenario: The date names the place of issue

- **GIVEN** a document created on 24 September 2026
- **WHEN** the letter is exported
- **THEN** the date line reads `ນະຄອນຫຼວງວຽງຈັນ, ວັນທີ 24/09/2026`

### Requirement: Proposer Identity Line

The exported PDF SHALL render a proposer line identifying the person the document is for,
resolved from the document's employee: the `document.related_employee` when present, otherwise the
employee record of `document.created_by` in the document's company. The line SHALL present:
- the employee `full_name`, labelled ຂ້າພະເຈົ້າ ທ້າວ/ນາງ;
- the employee `position`, labelled ຕຳແໜ່ງ;
- the employee `department` name, labelled ສັງກັດ ພະແນກ.

A missing `position` or an unresolved employee SHALL leave the corresponding value blank, and the
export SHALL still succeed.

The proposer line SHALL NOT carry any fixed statement of purpose (such as
`ມີຈຸດປະສົງ: ຂໍສະເໜີມາຍັງທ່ານ ເພື່ອຂໍ`). The purpose of a document is what the requester wrote in
the form, and a canned phrase ahead of it either repeats that or contradicts it.

#### Scenario: Proposer line reflects the document's employee

- **GIVEN** a document whose related/creating employee has a full name, position, and department
- **WHEN** the PDF is exported
- **THEN** the proposer line shows that full name, position, and department name

#### Scenario: Employee without a position still renders

- **GIVEN** a document whose employee has no `position`
- **WHEN** the PDF is exported
- **THEN** the proposer line shows the full name and department with an empty position and
  the export still succeeds

#### Scenario: No canned purpose follows the department

- **WHEN** any letter is exported
- **THEN** no text reading `ມີຈຸດປະສົງ` is printed on the proposer lines, and the requester's own
  reason appears only where the form puts it

### Requirement: Letter Body from Configured Form Fields

The exported PDF SHALL render the letter body from the field values configured for the
document's `form_template` (the fields defined via the form configuration), in
`form_field.sort_order` order, each labelled by its `form_field.field_label`. Only fields
that have a recorded value for the document SHALL appear.

The field whose value is printed on the subject line (see *The Letter's Subject Comes From The
Form's Subject Field*) SHALL NOT also appear in the body. A reader sees each value once, in the
place its name gives it.

#### Scenario: Body follows the configured form

- **GIVEN** a document whose form template defines fields A, B, C in sort order and the
  document has values for A and C
- **WHEN** the PDF is exported
- **THEN** the body shows A then C, each with its `field_label`, and omits B

#### Scenario: The subject is not repeated in the body

- **GIVEN** a form with fields `subject` (label ເລື່ອງ) and `Reson` (label ເຫດຜົນ), both with
  values
- **WHEN** the letter is exported
- **THEN** the subject value appears on the ເລື່ອງ line only, and the body shows ເຫດຜົນ with its
  value

### Requirement: Lao-Script Font Rendering

The exported PDF SHALL embed one font and use it as the default text face for the letter and every
sheet. The font SHALL draw Lao in Phetsarath OT, so that Lao characters in the national header,
company name, labels, proposer line, and body render as legible glyphs rather than missing-glyph
boxes. It SHALL draw ASCII digits, Latin letters and Latin punctuation in a Times New Roman design:
Tinos, which matches Times New Roman glyph for glyph and width for width and, unlike Times New
Roman, may be redistributed.

The two SHALL be merged into a single font file rather than switched between while drawing, so a
line is measured, wrapped and aligned in one face wherever it is centred, right-aligned or wrapped.

#### Scenario: Lao text renders with real glyphs

- **GIVEN** a company whose `name_th` contains Lao characters
- **WHEN** the PDF is exported
- **THEN** the company name and the Lao labels are rendered with the embedded font, not as
  missing-glyph boxes

#### Scenario: Digits and English print in Times

- **GIVEN** a subject reading `ການນຳໃຊ້ລະບົບ HAL EXPRESS APP` and a document dated 17/08/2026
- **WHEN** the letter is exported
- **THEN** `HAL EXPRESS APP` and `17/08/2026` are drawn in the Times design, and the Lao in
  Phetsarath OT

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

### Requirement: Proposer Signature Block

The signature row of every exported layout (the letter and each configured sheet) SHALL begin
with a proposer block headed ຜູ້ສະເໜີ, placed before the approver blocks. The block SHALL show
the proposer's name (the employee `full_name` of `document.created_by` in the document's company,
else the account username), the document's `submitted_at` date, and — when
`document.submitted_signature_id` is present — the signature image referenced by that stamp,
fetched server-side from object storage. The image SHALL be the one stamped at submit, never the
proposer's later current signature. When the stamp is null (a document submitted before the stamp
existed, or by an API key) the block SHALL show the name over a ruled line to sign by hand, and
the export SHALL still succeed. A document not yet submitted SHALL render the block with its
heading and an empty line. The proposer block SHALL NOT count against the rule that approver
blocks number at most the steps on the recorded route.

#### Scenario: The proposer's stamped signature is printed first

- **GIVEN** a document whose `submitted_signature_id` references S1
- **WHEN** it is exported
- **THEN** the first block in the signature row is headed ຜູ້ສະເໜີ and shows S1, the proposer's
  name and the submit date, followed by the approver blocks

#### Scenario: Replacing a signature after submit does not change the printed proposer block

- **GIVEN** a document that stamped S1 at submit
- **WHEN** the proposer uploads S2 and the document is exported again
- **THEN** the proposer block still shows S1

#### Scenario: A document with no stamped proposer signature leaves a line to sign

- **GIVEN** a document whose `submitted_signature_id` is null
- **WHEN** it is exported
- **THEN** the proposer block shows the name over a ruled line and the export succeeds

### Requirement: An Evidence Page Is Captioned By The Stored File Name

The caption an evidence page prints for an attachment SHALL be the attachment's stored `file_name`
— for attachments filed since names are generated, `<doc_no>-<nn><ext>`; for older ones, the name
they were filed under, repaired to readable text where the migration could. The caption SHALL NOT
be the uploader's `original_file_name`: the printed set is cross-referenced by document number, and
a caption that carries the number lets a reader tie a loose page back to its document.

#### Scenario: A new attachment's page is captioned by its generated name

- **GIVEN** an attachment stored as `RECBL-HAL-2026-0029-01.pdf` with original name `ໃບສະເໜີ.pdf`
- **WHEN** the document is exported
- **THEN** the evidence page for it is captioned `RECBL-HAL-2026-0029-01.pdf`

#### Scenario: An older attachment's page reads its Lao name correctly

- **GIVEN** an attachment whose garbled `file_name` was repaired to `ໃບສະເໜີ ລົດຮ່ວມ.pdf`
- **WHEN** the document is exported
- **THEN** its evidence page is captioned `ໃບສະເໜີ ລົດຮ່ວມ.pdf`

### Requirement: The Letter Lists Its References Under The Subject

The letter SHALL print, directly beneath the subject line, the recorded value of the document's
references field, found in this order:
1. The form field whose `form_field.field_name` is `ref`, matched case-insensitively, with `refs`,
   `reference` and `references` accepted as aliases, in that order of preference.
2. Only when no field bears one of those names: the form field whose `form_field.field_label` is
   `ອີງຕາມ`, compared after trimming whitespace and a trailing colon.

The field SHALL never be chosen by `field_type`.

The value SHALL be reduced to plain text and split into one entry per line (a rich-text paragraph
or list item is a line). Blank lines SHALL be dropped. An entry written with a number — an item of
a numbered list, or a line starting `1.` or `1)` — SHALL be drawn behind that number. Any other
entry SHALL be drawn behind a dash, with a leading dash or bullet typed by the requester removed so
it is not doubled. The marker SHALL stand in the column the subject line starts in, with the text in
a column of its own so that wrapped lines align under the text, not under the marker.

When the form has no such field, or its value has no non-blank line, no block SHALL be printed. The
field used SHALL NOT also appear in the letter body.

#### Scenario: Each line of the ref field is a dashed entry

- **GIVEN** a form with a `subject` field, a `ref` field holding two lines
  `- ອີງຕາມ ກ;` and `- ອີງຕາມ ຂ.`, and a `Reson` field
- **WHEN** the letter is exported
- **THEN** beneath the ເລື່ອງ line the letter prints `ອີງຕາມ ກ;` and `ອີງຕາມ ຂ.`, each behind one
  dash, and the body shows only ເຫດຜົນ

#### Scenario: A numbered list keeps its numbers

- **GIVEN** a `ref` field whose value is a numbered list of two items (saved by the editor as `<ol>`)
- **WHEN** the letter is exported
- **THEN** the two entries are drawn behind `1.` and `2.`, not behind dashes

#### Scenario: A form without a ref field prints no block

- **GIVEN** a form with no field named `ref` (or an alias) and none captioned ອີງຕາມ
- **WHEN** the letter is exported
- **THEN** the proposer line follows the ເລື່ອງ line with no references block

#### Scenario: A blank ref prints no block

- **GIVEN** a form with a `ref` field whose recorded value is empty or only markup
- **WHEN** the letter is exported
- **THEN** no references block is printed and the field is not in the body

### Requirement: The Letter's Subject Comes From The Form's Subject Field

The proposal letter's subject line (`ເລື່ອງ:`) SHALL print the recorded value of the document's
subject field, found in this order:
1. The form field whose `form_field.field_name` is `subject`, matched case-insensitively, with
   `topic` accepted as an alias. When both are present, `subject` wins.
2. Only when no field bears either name: the form field whose `form_field.field_label` is
   `ເລື່ອງ`, compared after trimming whitespace and a trailing colon.

The name SHALL take precedence because it is fixed once the field exists, while a label is
translated per company and may be edited. The label fallback exists so that a form configured with
a different field name but captioned ເລື່ອງ still fills the line. The field SHALL never be chosen by
`field_type`, because several fields may share a type.

The value SHALL be printed as plain text, with HTML markup and entities stripped and whitespace
collapsed. When the form has no such field, or the document recorded no non-empty value for it,
the line SHALL print the dotted blank it prints today, so it can be written by hand.

No column SHALL be added to `document` for this. The subject is configuration: a form that should
print one carries a `subject` field, and a form that does not carry one prints the blank.

#### Scenario: A form with a subject field prints it

- **GIVEN** a document whose form has a `text` field named `subject`, labelled ເລື່ອງ, holding
  `ຂໍອະນຸມັດຈັດຊື້ຄອມພິວເຕີ`
- **WHEN** its letter is exported
- **THEN** the subject line reads `ເລື່ອງ: ຂໍອະນຸມັດຈັດຊື້ຄອມພິວເຕີ`

#### Scenario: The name decides, not the order or the type

- **GIVEN** a form whose first text field is `subject` and whose second is `Reson`
- **WHEN** the letter is exported
- **THEN** the `subject` value is on the ເລື່ອງ line and the `Reson` value is under ເຫດຜົນ in the
  body, and swapping their sort order changes neither

#### Scenario: The name is matched without regard to case

- **GIVEN** a form field named `Subject`
- **WHEN** the letter is exported
- **THEN** its value is printed on the subject line

#### Scenario: A field captioned ເລື່ອງ is used when no field is named subject

- **GIVEN** a form with a text field named `title`, labelled `ເລື່ອງ:`, holding `ຂໍເບີກຄ່າເດີນທາງ`,
  and no field named `subject` or `topic`
- **WHEN** the letter is exported
- **THEN** the subject line reads `ເລື່ອງ: ຂໍເບີກຄ່າເດີນທາງ`, and that field is not repeated in the
  body

#### Scenario: The name wins over the label

- **GIVEN** a form with a field named `subject` holding `A`, and another field named `heading`
  labelled `ເລື່ອງ` holding `B`
- **WHEN** the letter is exported
- **THEN** the subject line prints `A`, and `B` stays in the body under its label

#### Scenario: A form without a subject field keeps the blank line

- **GIVEN** a form whose fields are `date`, `Reson` and `file`
- **WHEN** the letter is exported
- **THEN** the subject line is `ເລື່ອງ:` followed by the dotted blank

#### Scenario: An empty subject keeps the blank line

- **GIVEN** a form with a `subject` field whose recorded value is empty or only markup
- **WHEN** the letter is exported
- **THEN** the subject line is the dotted blank

### Requirement: Signatures Are Centred In Their Column

On the proposal letter, each stamped signature image SHALL be scaled to fit its column's signature
area without distortion, and SHALL be centred within that area both horizontally and vertically,
whatever its aspect ratio. The heading, the dotted baseline, the name and the date SHALL stay
centred on the same column axis, so the whole block reads as one centred unit.

#### Scenario: A tall, narrow signature is centred

- **GIVEN** a proposer whose stamped signature is taller than it is wide
- **WHEN** the letter is exported
- **THEN** the image's horizontal centre is the centre of the proposer's column

#### Scenario: A wide signature is centred

- **GIVEN** an approver whose stamped signature is much wider than it is tall
- **WHEN** the letter is exported
- **THEN** the image fits within the column's signature area and its horizontal centre is the
  column's centre

