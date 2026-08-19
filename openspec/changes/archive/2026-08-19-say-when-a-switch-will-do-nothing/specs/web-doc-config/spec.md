# web-doc-config

## ADDED Requirements

### Requirement: A Configuration Screen Says When A Setting Cannot Take Effect

The web app SHALL tell the administrator, at the moment of setting it, when a configuration value
cannot take effect because of another value in the same configuration, and SHALL name the
prerequisite rather than only the symptom.

Several settings are read only under a condition that another field controls. Set outside that
condition they save without complaint and are never read, so the screen is the only place the
administrator can learn it — the server is right to accept them, because each is harmless and the
prerequisite is editable, and the natural order of work is often to name the target before enabling
the mechanism that uses it.

The following SHALL be stated:

- **Auto-create on a reference pairing**, when the predecessor's post-action does not create
  successors. The flag is read only on the create-successor path, so no pairing from any other type
  is ever consulted.
- **The successor department on a pairing**, which is read only when an auto-created successor is
  being placed. Here the screen already declines to offer it at all unless auto-create is on, which
  settles the same question ahead of it being asked; it SHALL continue not to offer it.
- **An escalation target on a workflow step**, when the step has no SLA. Escalation is driven by a
  step being overdue, and a step with no SLA is never overdue.
- **An escalation target on a workflow step**, when the step's approve mode declines escalation.

The setting SHALL remain editable and the control SHALL NOT be disabled. Disabling it would refuse
the configuration by another means and would impose an order of work the screen invented; the
statement is advisory because the setting is harmless.

The condition SHALL be derived from configuration the screen already holds, without an additional
read. Where a rule is stated on a screen that the server also implements, the two SHALL be kept in
step — a screen that says a setting is inert when it is not is worse than a screen that says
nothing.

#### Scenario: Auto-create on a predecessor that creates no successors

- **GIVEN** a document type whose post-action does not create successors
- **WHEN** its reference-chain successors are configured
- **THEN** the screen states that auto-create will not run for this predecessor, and the switch
  remains settable

#### Scenario: Auto-create on a predecessor that does create successors

- **GIVEN** a document type whose post-action creates successors
- **WHEN** its reference-chain successors are configured
- **THEN** no such statement is shown

#### Scenario: A successor department without auto-create

- **GIVEN** a pairing whose auto-create is off
- **WHEN** its successors are configured
- **THEN** no successor department is offered for it, so none can be set inertly

#### Scenario: An escalation target on a step with no SLA

- **GIVEN** a workflow step with no SLA
- **WHEN** its escalation target is configured
- **THEN** the screen states that escalation needs an SLA before it can fire, and the target remains
  settable

#### Scenario: An escalation target on a step whose mode declines escalation

- **GIVEN** a workflow step in an approve mode that is chased rather than reassigned
- **WHEN** its escalation target is configured
- **THEN** the screen states that this mode does not escalate

#### Scenario: A step that can escalate says nothing

- **GIVEN** a workflow step with an SLA, in a mode that escalates
- **WHEN** its escalation target is configured
- **THEN** no such statement is shown
