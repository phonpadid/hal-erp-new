## MODIFIED Requirements

### Requirement: Act on a Document

The web app SHALL let an eligible approver Approve, Reject, or Return a document with an
optional remark, and reflect the resulting status. Server-side rejections (not eligible, not
in approval, self-approval) SHALL be surfaced.

Before the decision, the approver SHALL be shown what the document does. For a document carrying
budget movements that means the movement type, the budget each names, and the amount — in the same
place the amount is already shown, not one navigation away.

An approval is the control this system puts in front of every movement of money, and it is worth
only what the approver can see. Showing an amount and a type without naming the budget asks a person
to sign for twelve million kip going somewhere unstated.

#### Scenario: Approve advances the document

- **WHEN** an eligible approver approves a document on its final step
- **THEN** the document becomes COMPLETED and the action appears in its approval log

#### Scenario: Reject releases and stops routing

- **WHEN** an eligible approver rejects a document
- **THEN** the document becomes REJECTED and the detail reflects it

#### Scenario: The approver sees which budget an amount lands on

- **GIVEN** a budget plan proposing 12,000,000 for one budget
- **WHEN** the approver opens it to act
- **THEN** the budget's code and name are shown beside the amount, before Approve is available

#### Scenario: A document with no movements shows none

- **WHEN** the approver opens a disbursement whose content is document lines
- **THEN** no movement section is shown, and the existing amount and type are unchanged
