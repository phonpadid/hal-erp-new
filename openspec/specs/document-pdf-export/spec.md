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
already read. The PDF SHALL be rendered in the Lao official-letter layout (ໃບສະເໜີ): a Lao
national header, the issuing company's logo and name, the document number (`doc_no`) as
ເລກທີ and the document `created_at` as ວັນທີ, a proposer identity line drawn from the
document's employee, and the document's configured form field values as the letter body. It
SHALL also include the approval trail and the per-step signature blocks. The endpoint SHALL
stream the generated PDF rather than persisting it as a stored attachment. All company data
rendered (logo, name) SHALL come only from the document's own `company`, so no other
company's data is disclosed.

#### Scenario: Authorized caller exports an approved document

- **GIVEN** a user authorized to read a COMPLETED document in the active company
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

### Requirement: Configurable Per-Step Signature Blocks

The number and identity of signature blocks on the exported PDF SHALL be driven by
`workflow_step.show_signature_on_pdf`: the PDF SHALL render a signature block for each
workflow step flagged on, in `step_no` order, and SHALL NOT render one for a step flagged
off. Because a block exists only per configured step, the number of signature blocks SHALL
always be `<=` the workflow's step count. Each block SHALL be labelled with its
`workflow_step.step_name`. This configuration SHALL NOT change how documents are routed or
approved — it only controls PDF output.

#### Scenario: Only flagged steps produce signature blocks

- **GIVEN** a 3-step workflow with steps 1 and 3 flagged `show_signature_on_pdf` and step 2 not
- **WHEN** the document PDF is exported
- **THEN** the PDF shows exactly two signature blocks, for steps 1 and 3, labelled by their
  `step_name`, and none for step 2

#### Scenario: Signature block count never exceeds step count

- **GIVEN** any workflow
- **WHEN** its document is exported
- **THEN** the number of signature blocks is at most the number of workflow steps

#### Scenario: Flag does not affect approval routing

- **GIVEN** a step flagged off for the PDF
- **WHEN** the document routes through that step
- **THEN** the step is still approved normally and only its appearance on the PDF is suppressed

### Requirement: Embed Stamped Approver Signatures in the PDF

The PDF SHALL render, for each signature block (a step flagged `show_signature_on_pdf`)
that has an APPROVE entry, the approver's name, the acted-at timestamp, and — when the
`approval_log.signature_id` is present — the signature image referenced by that snapshot,
fetched server-side from object storage. The rendered signature SHALL be the one
stamped at approval time, never the approver's later current signature. When the APPROVE
entry has no stamped signature, the block SHALL show the approver name and timestamp with a
"signature not on file" placeholder. When a flagged step has not yet been approved (export
of an in-progress document), the block SHALL render empty with only its step label. The
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

#### Scenario: Approver without a signature still renders

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

The exported PDF SHALL render the issuing company's logo and name below the national header.
The logo SHALL be the image at the document's `company.profile_image_path`, fetched
server-side from object storage; when the company has no `profile_image_path` or the object
cannot be fetched, the logo SHALL be omitted and the export SHALL still succeed. The company
name SHALL be `company.name_th`.

#### Scenario: Company with a logo shows its logo and name

- **GIVEN** a document whose company has a `profile_image_path`
- **WHEN** the PDF is exported
- **THEN** the PDF shows that company's logo image and its `name_th`

#### Scenario: Company without a logo still exports

- **GIVEN** a document whose company has no `profile_image_path`
- **WHEN** the PDF is exported
- **THEN** the company name is shown, no logo image is rendered, and the export succeeds

### Requirement: Document Number and Date Fields

The exported PDF SHALL show, in the header area, a ເລກທີ field bound to the document's
`doc_no` and a ວັນທີ field bound to the document's `created_at` rendered as a date.

#### Scenario: Number and date reflect the document

- **GIVEN** a document with a `doc_no` and a `created_at`
- **WHEN** the PDF is exported
- **THEN** ເລກທີ shows the `doc_no` and ວັນທີ shows the `created_at` formatted as a date

### Requirement: Proposer Identity Line

The exported PDF SHALL render a proposer line identifying the person the document is for,
resolved from the document's employee — the `document.related_employee` when present,
otherwise the employee record of `document.created_by` in the document's company. The line
SHALL present the employee `full_name` (labelled ຂ້າພະເຈົ້າ ທ້າວ/ນາງ), the employee
`position` (labelled ຕຳແໜ່ງ), and the employee `department` name (labelled ສັງກັດ ພະແນກ). A
missing `position` or unresolved employee SHALL leave the corresponding value blank and the
export SHALL still succeed.

#### Scenario: Proposer line reflects the document's employee

- **GIVEN** a document whose related/creating employee has a full name, position, and department
- **WHEN** the PDF is exported
- **THEN** the proposer line shows that full name, position, and department name

#### Scenario: Employee without a position still renders

- **GIVEN** a document whose employee has no `position`
- **WHEN** the PDF is exported
- **THEN** the proposer line shows the full name and department with an empty position and
  the export still succeeds

### Requirement: Letter Body from Configured Form Fields

The exported PDF SHALL render the letter body from the field values configured for the
document's `form_template` (the fields defined via the form configuration), in
`form_field.sort_order` order, each labelled by its `form_field.field_label`. Only fields
that have a recorded value for the document SHALL appear.

#### Scenario: Body follows the configured form

- **GIVEN** a document whose form template defines fields A, B, C in sort order and the
  document has values for A and C
- **WHEN** the PDF is exported
- **THEN** the body shows A then C, each with its `field_label`, and omits B

### Requirement: Lao-Script Font Rendering

The exported PDF SHALL embed a Lao Unicode font and use it as the default text face so that
Lao (and Thai) characters in the national header, company name, labels, proposer line, and
body render as legible glyphs rather than missing-glyph boxes.

#### Scenario: Lao text renders with real glyphs

- **GIVEN** a company whose `name_th` contains Lao characters
- **WHEN** the PDF is exported
- **THEN** the company name and the Lao labels are rendered with the embedded Lao font, not
  as missing-glyph boxes
