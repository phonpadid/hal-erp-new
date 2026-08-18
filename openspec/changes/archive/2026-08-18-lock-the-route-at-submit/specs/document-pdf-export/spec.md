# document-pdf-export

## MODIFIED Requirements

### Requirement: Configurable Per-Step Signature Blocks

The number and identity of signature blocks on the exported PDF SHALL be driven by the
`show_signature_on_pdf` flag **recorded on the document's own route** at submit: the PDF SHALL
render a signature block for each recorded step flagged on, in `step_no` order, and SHALL NOT
render one for a step flagged off. Because a block exists only per recorded step, the number of
signature blocks SHALL always be `<=` the number of steps the document actually routed through.
Each block SHALL be labelled with that recorded step's `step_name`. This configuration SHALL NOT
change how documents are routed or approved — it only controls PDF output.

Re-exporting a document SHALL produce the same sheet it produced before, whatever has since been
done to the workflow it was routed by. A sheet that was printed and signed by hand is evidence, and
evidence that changes when a configuration is edited is not evidence — the same argument
`payment-batch` makes for storing the exact bytes sent to a bank.

#### Scenario: Only flagged steps produce signature blocks

- **GIVEN** a 3-step route with steps 1 and 3 flagged `show_signature_on_pdf` and step 2 not
- **WHEN** the document PDF is exported
- **THEN** the PDF shows exactly two signature blocks, for steps 1 and 3, labelled by their
  `step_name`, and none for step 2

#### Scenario: Signature block count never exceeds step count

- **GIVEN** any document
- **WHEN** it is exported
- **THEN** the number of signature blocks is at most the number of steps on its recorded route

#### Scenario: An issued sheet does not change when the workflow does

- **GIVEN** an approved document whose PDF has been exported
- **WHEN** the workflow it routed through gains a step, loses one, or has a step renamed or
  re-flagged
- **THEN** re-exporting that document produces the same blocks, in the same order, with the same
  labels

#### Scenario: Flag does not affect approval routing

- **GIVEN** a step flagged off for the PDF
- **WHEN** the document routes through that step
- **THEN** the step is still approved normally and only its appearance on the PDF is suppressed
