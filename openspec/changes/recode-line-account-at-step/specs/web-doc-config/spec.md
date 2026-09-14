## ADDED Requirements

### Requirement: The Step Editor Offers The Account-Recode Allowance

The workflow step editor SHALL let a `WORKFLOW_MANAGE` user set whether the step's approver may
re-code the account a line posts to (`allowsAccountRecode`), presented as a toggle that is off by
default, beside the payment-evidence requirement. The workflow detail view SHALL show the allowance
on every step that carries it, alongside the step's approver, amount range, approval mode, SLA
hours, escalation target and evidence requirement, rather than leaving it discoverable only by
opening the editor.

The client-side schema for the field SHALL mirror the server DTO, so client and server validation
do not drift.

The editor SHALL state what the setting does in the approver's terms — that the approver of this
step can change which account each line is expensed to, that the budget and the amounts do not
move, and that every change is recorded in the approval history — because a setting that quietly
lets a line's account be changed is the kind of thing an auditor asks about first.

Where the step's configured approver could never use the allowance — the approver role or person
holds no `DOC_LINE_RECODE` — the editor SHALL say so, following the existing rule that a
configuration screen says when a setting cannot take effect. The editor SHALL NOT refuse the
configuration on those grounds: the permission can be granted afterwards, and the screen's job is
to make the consequence visible, not to decide it.

#### Scenario: Authoring the allowance on a step

- **GIVEN** a `WORKFLOW_MANAGE` user editing a workflow step
- **WHEN** the user turns the account-recode allowance on and saves
- **THEN** the step is stored with `allowsAccountRecode` true

#### Scenario: The default is off

- **WHEN** the user opens the editor for a step that has never carried the allowance
- **THEN** the toggle is off

#### Scenario: The allowance is visible without opening the editor

- **GIVEN** a workflow with one step allowing account re-coding
- **WHEN** a `WORKFLOW_MANAGE` user opens the workflow detail view
- **THEN** that step is shown as allowing re-coding and the others are not

#### Scenario: An approver who could not use the allowance is flagged

- **GIVEN** a step whose approver role holds no `DOC_LINE_RECODE`
- **WHEN** the user turns the account-recode allowance on
- **THEN** the editor states that the configured approver cannot re-code accounts
- **AND** the configuration can still be saved
