## ADDED Requirements

### Requirement: Export Document as PDF

The system SHALL expose an authenticated endpoint that renders a document as a PDF,
identified by document id in the path. Access SHALL require the same read authorization
and active-company scope as reading the document itself: a caller who may read the
document MAY export it, and the export SHALL NOT reveal any document the caller could not
already read. The PDF SHALL include the document header (`doc_no`, type, company,
department, status), its form field values and line items, and its approval trail. The
endpoint SHALL stream the generated PDF rather than persisting it as a stored attachment.

#### Scenario: Authorized caller exports an approved document

- **GIVEN** a user authorized to read a COMPLETED document in the active company
- **WHEN** they request its PDF export
- **THEN** a PDF is returned containing the document details and its approval trail

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
