## MODIFIED Requirements

### Requirement: Permission-Gated Document Affordances

Document actions SHALL be shown by permission code and document status: create only with
`DOC_CREATE`, submit only with `DOC_SUBMIT` on a DRAFT, cancel only with `DOC_CANCEL`.
Affordances the user lacks are hidden (UX only; the server still enforces).

The list's Approve action SHALL be shown only for the rows the server reports as actionable by the
current user, and SHALL be ABSENT — not merely disabled — for every other row. A permission code
alone SHALL NOT qualify a row: `DOC_APPROVE` is held company-wide, so a user holding it SHALL NOT
be offered the action on a document whose route has not reached them, nor on a document they raised
themselves (invariant 8).

The actionable set SHALL be resolved by the same server-side path that answers the approval inbox,
so the list and the inbox can never disagree about who may act. The client SHALL NOT re-derive
eligibility, delegation, or the self-approval exclusion of its own.

#### Scenario: Submit hidden without permission

- **WHEN** a user without `DOC_SUBMIT` views their draft
- **THEN** the Submit action is not shown

#### Scenario: An approver whose turn has not come sees no Approve action

- **GIVEN** a user holding `DOC_APPROVE` and an IN_APPROVAL document sitting on an earlier step
  that does not name them
- **WHEN** they view the list
- **THEN** no Approve action is rendered on that row

#### Scenario: A requester is not offered approval of their own document

- **GIVEN** a user holding `DOC_APPROVE` who raised the document themselves
- **WHEN** they view the list while it is IN_APPROVAL
- **THEN** no Approve action is rendered on that row

#### Scenario: The eligible approver is offered the action

- **GIVEN** an IN_APPROVAL document whose open step names the current user
- **WHEN** they view the list
- **THEN** the Approve action is rendered on that row and opens the review dialog

#### Scenario: A finished document offers no Approve action

- **GIVEN** an APPROVED or COMPLETED document
- **WHEN** any user views the list
- **THEN** no Approve action is rendered on that row

## ADDED Requirements

### Requirement: The List Says Who Raised Each Document

The documents list SHALL show a column naming the person who raised each document, with their
department beneath the name, both taken from the server-resolved row rather than derived in the
client. When the server could name nobody, the column SHALL show the muted dash the list uses for
an absent value.

#### Scenario: The requester and their department are named

- **WHEN** the list renders a row whose server data carries a requester name and department
- **THEN** the column shows the name with the department beneath it

#### Scenario: A creator with no employee record shows the name alone

- **WHEN** the list renders a row carrying a name but no department
- **THEN** the column shows the name and no department line

#### Scenario: A row the server could not name shows a dash

- **WHEN** the list renders a row carrying neither name nor department
- **THEN** the column shows the muted dash

### Requirement: Finance Registers the Documents That Reached Them

The documents list SHALL show an intake column — stating whether each document has been received
and, when it has, who received it and when — ONLY to users holding `DOC_INTAKE_RECEIVE` or
`DOC_INTAKE_REVERSE`. A department with no intake duty SHALL see the list unchanged: not the
column, not the row selection, and not the bulk action. Intake is one office's record of what
landed on its desk, and a column every department read would present it as a state of the document
itself.

Users who may receive documents SHALL be able to register receipt of a single document from the
row itself, and to select several rows and register the selection in one action. The row action
SHALL be present whenever the bulk one is, because the bulk affordance alone is not reachable on a
wide screen: its tick boxes sit in the leftmost column of a table that scrolls sideways, and its
button is disabled until a row is ticked.

A row already received SHALL present as received and SHALL NOT offer to be received again. After a
batch completes, the screen SHALL report how many were received and SHALL name each document that
was refused together with its reason, rather than reporting a single success or a single failure
for the batch.

Reversing a receipt SHALL be offered only to users holding `DOC_INTAKE_REVERSE`.

The intake state SHALL be read from the server on every list load, so a document a colleague
received moments earlier reads as received here.

#### Scenario: Finance receives a week's documents in one action

- **GIVEN** a user holding `DOC_INTAKE_RECEIVE` viewing the list filtered to this week
- **WHEN** they select several documents that reached them and register receipt
- **THEN** each selected row reads as received, naming them and the time

#### Scenario: A department with no intake duty sees no intake column at all

- **WHEN** a user holding neither intake code views the list
- **THEN** the intake column is absent, and so are the row selection and the receive action

#### Scenario: Either intake code brings the column

- **WHEN** a user holding only `DOC_INTAKE_REVERSE` views the list
- **THEN** the intake column is shown

#### Scenario: A single document is received from its own row

- **GIVEN** a user holding `DOC_INTAKE_RECEIVE`
- **WHEN** they use the receive action on a row that has not been received
- **THEN** that document alone is registered, and the row reads as received

#### Scenario: An already-received document is not offered again

- **GIVEN** a document that reads as received
- **WHEN** a user holding `DOC_INTAKE_RECEIVE` views the list
- **THEN** the row shows it as received and offers no receive action for it

#### Scenario: A partly refused batch names what it refused

- **GIVEN** a selection in which one document was already received by a colleague
- **WHEN** the user registers receipt of the selection
- **THEN** the rest read as received and the screen names the refused document and why

#### Scenario: Reversal is offered only with its own code

- **GIVEN** a received document
- **WHEN** a user holding `DOC_INTAKE_RECEIVE` but not `DOC_INTAKE_REVERSE` views the list
- **THEN** no reversal action is offered

### Requirement: The List States Amounts In A Named Currency At Its Own Precision

The documents list's base-currency total SHALL be formatted to the active company's base currency
`decimal_places` and SHALL be labelled with that currency's code. It SHALL NOT be formatted to a
fixed number of decimal places, and SHALL NOT be shown unlabelled.

A row carrying no base total SHALL read as absent rather than as zero.

#### Scenario: A zero-decimal base currency is not given hundredths

- **GIVEN** a company whose base currency is LAK, which carries no decimal places
- **WHEN** the list renders a base total of 100000
- **THEN** it reads `100,000 LAK`, not `100,000.00`

#### Scenario: A row with no base total says so

- **WHEN** the list renders a row whose base total is absent
- **THEN** the cell reads as none rather than as a zero amount
