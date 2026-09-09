## ADDED Requirements

### Requirement: An Approver Sees And Satisfies A Step's Evidence Requirement

Where the step a document is on requires a bank-transfer slip, the approval surface SHALL state the requirement and whether it is currently met, before the approver acts. The approve affordance SHALL be disabled while no slip is attached, and the reason SHALL be stated next to it rather than left to a failed request — a disabled control that does not say why is a defect report waiting to be filed.

A `PAYMENT_MANAGE` approver SHALL be able to attach the slip from the approval surface itself, without navigating to a payment screen, because the document is not payable yet and no payment screen applies to it. Once a slip is attached the approve affordance SHALL become available without the approver reloading the page.

An approver lacking `PAYMENT_MANAGE` SHALL be shown the requirement and its state but no upload control, mirroring the server's rules; the client guard is UX only and the server still enforces.

The reject and return affordances SHALL remain enabled regardless of the requirement, so a document that cannot be evidenced can still be sent back or refused.

The server SHALL remain the authority: an approval submitted while the requirement is unmet SHALL be refused with the reason, and the surface SHALL show that reason rather than a generic failure.

#### Scenario: The requirement is stated before the approver acts

- **GIVEN** a document at a step requiring payment evidence, carrying no slip
- **WHEN** an eligible approver opens it
- **THEN** the surface states that a transfer slip is required and that none is attached
- **AND** the approve affordance is disabled with that reason shown

#### Scenario: The approver attaches the slip in place

- **GIVEN** the same document opened by an approver holding `PAYMENT_MANAGE`
- **WHEN** the approver uploads a slip from the approval surface
- **THEN** the slip is attached to the document and the approve affordance becomes available

#### Scenario: An approver without the upload permission

- **GIVEN** an eligible approver holding neither `PAYMENT_MANAGE` nor an attached slip
- **WHEN** the approver opens the document
- **THEN** the requirement and its unmet state are shown with no upload control

#### Scenario: Rejecting stays available

- **GIVEN** a document at a step requiring evidence, carrying no slip
- **WHEN** an eligible approver opens it
- **THEN** the reject and return affordances are enabled

#### Scenario: A refusal from the server is explained

- **GIVEN** a slip deleted by another user after the approval surface was rendered
- **WHEN** the approver approves
- **THEN** the request is refused and the surface states that the required evidence is missing
