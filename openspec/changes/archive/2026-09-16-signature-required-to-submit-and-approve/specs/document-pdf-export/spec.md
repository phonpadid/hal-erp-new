## ADDED Requirements

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

## MODIFIED Requirements

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
