## ADDED Requirements

### Requirement: A Step May Require Payment Evidence Before It Is Approved

A `workflow_step` SHALL carry `requires_payment_slip` (boolean, NOT NULL, default false). When a step's `requires_payment_slip` is true, an APPROVE on that step SHALL be refused unless the document already carries at least one `payment_attachment` row. The refusal SHALL name the reason, so the approver learns that evidence is missing rather than that the action failed.

The requirement SHALL be read from the step the document is currently on, not from the document's type, its amount, or its step number. Behaviour comes from configuration (invariant 7).

REJECT, RETURN and DELEGATE SHALL NOT be gated by this requirement. A step that cannot yet be approved MUST still be refusable and returnable, or a document with no evidence and no prospect of any could never leave approval.

The gate SHALL run inside the same transaction and under the same pessimistic write lock on the document as the rest of the approve path, after the eligibility and self-approval checks and BEFORE the `approval_log` row is written. A refused approval SHALL leave no `approval_log` row, SHALL NOT advance `document.current_step_no`, SHALL NOT close or open a step, and SHALL NOT release any budget or quota hold. `approval_log` is append-only (invariant 2), so an approval that must be refused SHALL be refused before it is recorded, never compensated afterwards.

Escalation SHALL NOT be gated by this requirement: the SLA sweeper reassigns a late step without an APPROVE, and lateness is not evidence.

#### Scenario: Approval is refused while no evidence is attached

- **GIVEN** a document in approval at a step whose `requires_payment_slip` is true, carrying no `payment_attachment`
- **WHEN** an eligible approver approves the step
- **THEN** the request is rejected naming the missing evidence
- **AND** no `approval_log` row is written and `document.current_step_no` is unchanged

#### Scenario: Approval succeeds once evidence is attached

- **GIVEN** the same document after a `PAYMENT_MANAGE` user has uploaded one slip against it
- **WHEN** the eligible approver approves the step
- **THEN** the approval is recorded and the route advances as it would for any step

#### Scenario: A step without the requirement is unaffected

- **GIVEN** a document at a step whose `requires_payment_slip` is false, carrying no slip
- **WHEN** an eligible approver approves the step
- **THEN** the approval is recorded

#### Scenario: Rejecting is always available

- **GIVEN** a document at a step requiring evidence, carrying no slip
- **WHEN** an eligible approver rejects the document
- **THEN** the rejection is recorded and the reserved budget and quota are released

#### Scenario: Returning is always available

- **GIVEN** a document at a step requiring evidence, carrying no slip
- **WHEN** an eligible approver returns the document
- **THEN** the document goes back to DRAFT and its holds are released

#### Scenario: Evidence attached to another document does not satisfy the step

- **GIVEN** a document at a step requiring evidence, carrying no slip, while a different document carries one
- **WHEN** an eligible approver approves the step
- **THEN** the request is rejected

#### Scenario: Two approvers racing the same gated step

- **GIVEN** a document at a step requiring evidence, carrying no slip
- **WHEN** two eligible approvers approve concurrently
- **THEN** both are refused and no `approval_log` row is written for either

### Requirement: The Payment-Evidence Requirement Is Configured On The Step

Creating or updating a `workflow_step` SHALL accept `requiresPaymentSlip` as a boolean and SHALL persist it to `workflow_step.requires_payment_slip`, under the same `WORKFLOW_MANAGE` permission, the same active-company scoping and the same single transaction as every other step field. Omitting the field on create SHALL store false. The step read surface SHALL return the flag, so a configuration screen can show what was authored.

Setting the flag SHALL be permitted while the workflow has documents in approval, like every other step mutation. Routing reads the route recorded on each document, so the change reaches documents submitted afterwards and cannot reach one already routing.

#### Scenario: The flag is authored on a step

- **GIVEN** a `WORKFLOW_MANAGE` user in the active company
- **WHEN** the user updates a step with `requiresPaymentSlip` true
- **THEN** `workflow_step.requires_payment_slip` is stored true for that step

#### Scenario: Omitting the field stores false

- **WHEN** a step is created without `requiresPaymentSlip`
- **THEN** the stored value is false

#### Scenario: The flag is returned when the step is read

- **GIVEN** a step whose `requires_payment_slip` is true
- **WHEN** a `WORKFLOW_MANAGE` user reads the workflow's steps
- **THEN** the step is returned carrying the flag

#### Scenario: Another company's workflow is refused

- **GIVEN** a step belonging to a workflow of another company
- **WHEN** a user sets `requiresPaymentSlip` on it
- **THEN** the request is refused as not-found, as for any other step mutation
