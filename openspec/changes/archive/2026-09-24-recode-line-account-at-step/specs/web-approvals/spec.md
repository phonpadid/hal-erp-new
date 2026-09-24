## ADDED Requirements

### Requirement: An Approver Re-Codes A Line's Account Where They Act

The document detail SHALL let an approver re-code a line's account where they act. Where the route
step a document is on allows account re-coding, the detail — the surface on which the approver acts
— SHALL let an approver who can act on the current step and holds `DOC_LINE_RECODE` change the
account of one line in place, from a picker limited to active,
postable accounts of the active company showing each account's code and name. The line's current
account SHALL be shown before the change, and the lines and the approval history SHALL refresh
after it without the approver reloading the page.

Whether the control is offered SHALL come from the document detail read, which SHALL report
whether the current route step allows re-coding and whether this viewer may re-code now — the
same gates the recode itself applies: document in approval, step allows it, viewer eligible — so
the surface mirrors the server's rule rather than re-implementing it; the client guard is UX only and the
server still enforces. Where the control is not offered the surface SHALL say why when the reason
is the step or the document's state, and SHALL say nothing when the reason is that the viewer is
not this step's approver — a requester does not need to be told what the accountant may do.

An approver lacking `DOC_LINE_RECODE` SHALL see the line's account but no control, mirroring the
server.

The approve, reject and return affordances SHALL be unaffected by whether any line was re-coded.

The approval history SHALL render a `RECODE_ACCOUNT` row in the approver's terms — which line,
from which account to which, by whom, when — in the same row shape as every other action,
localised.

The server SHALL remain the authority: a recode refused by the server SHALL show the server's
reason rather than a generic failure, and SHALL leave the line as it was.

#### Scenario: The control is offered to the eligible accountant

- **GIVEN** a document `IN_APPROVAL` on a step allowing re-coding, opened by an eligible approver
  holding `DOC_LINE_RECODE`
- **WHEN** the approver opens the document
- **THEN** each priced line's account is shown with a control to change it

#### Scenario: The approver re-codes a line in place

- **GIVEN** the same document, line 2 on `612.06`
- **WHEN** the approver picks `615.01` for line 2 and confirms
- **THEN** line 2 shows `615.01`, and the approval history shows a re-code row naming line 2,
  `612.06`, `615.01` and the approver

#### Scenario: An eligible approver without the permission

- **GIVEN** the same document opened by an eligible approver who does not hold `DOC_LINE_RECODE`
- **WHEN** the approver opens the document
- **THEN** the lines show their accounts and no control is offered

#### Scenario: A step that does not allow it

- **GIVEN** a document on a step whose allowance is off, opened by an eligible approver holding
  `DOC_LINE_RECODE`
- **WHEN** the approver opens the document
- **THEN** no control is offered and the surface says this step does not allow re-coding

#### Scenario: The server refuses

- **GIVEN** the control offered, and the document completed by another approver in the meantime
- **WHEN** the approver confirms a re-code
- **THEN** the surface shows the server's reason — the document is no longer in approval — and the
  line is shown as it was

#### Scenario: The history shows the move

- **GIVEN** a document whose line 2 was re-coded from `612.06` to `615.01` by an accountant
- **WHEN** any user who can read the document opens its approval history
- **THEN** a row between the surrounding approvals reads that line 2 was re-coded from `612.06` to
  `615.01`, naming the accountant and the time
