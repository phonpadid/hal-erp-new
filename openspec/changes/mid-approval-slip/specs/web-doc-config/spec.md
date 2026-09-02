## ADDED Requirements

### Requirement: The Step Editor Offers The Payment-Evidence Requirement

The workflow step editor SHALL let a `WORKFLOW_MANAGE` user set whether the step requires a bank-transfer slip before it can be approved (`requiresPaymentSlip`), presented as a checkbox that is unchecked by default. The workflow detail view SHALL show the requirement on every step that carries it, alongside the step's approver, amount range, approval mode, SLA hours and escalation target, rather than leaving it discoverable only by opening the editor.

The client-side schema for the field SHALL mirror the server DTO, so client and server validation do not drift.

The editor SHALL state what the setting does in the approver's terms — that the step cannot be approved until a slip is attached, and that rejecting and returning stay available — because a setting that silently blocks an approval is indistinguishable from a broken step to the person it blocks.

Where the step's configured approver could never satisfy the requirement — the approver role or person holds no `PAYMENT_MANAGE` — the editor SHALL say so, following the existing rule that a configuration screen says when a setting cannot take effect. The editor SHALL NOT refuse the configuration on those grounds: the permission can be granted afterwards, and the screen's job is to make the consequence visible, not to decide it.

#### Scenario: Authoring the requirement on a step

- **GIVEN** a `WORKFLOW_MANAGE` user editing a workflow step
- **WHEN** the user checks the payment-evidence requirement and saves
- **THEN** the step is stored with `requiresPaymentSlip` true

#### Scenario: The default is off

- **WHEN** the user opens the editor for a step that has never carried the requirement
- **THEN** the checkbox is unchecked

#### Scenario: The requirement is visible without opening the editor

- **GIVEN** a workflow with one step requiring payment evidence
- **WHEN** a `WORKFLOW_MANAGE` user opens the workflow detail view
- **THEN** that step is shown as requiring evidence and the others are not

#### Scenario: An approver who could not satisfy the requirement is flagged

- **GIVEN** a step whose approver role holds no `PAYMENT_MANAGE`
- **WHEN** the user checks the payment-evidence requirement
- **THEN** the editor states that the configured approver cannot attach a slip
- **AND** the configuration can still be saved
