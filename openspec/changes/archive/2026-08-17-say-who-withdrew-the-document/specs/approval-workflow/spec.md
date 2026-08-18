# approval-workflow

## MODIFIED Requirements

### Requirement: Append-Only Audit Trail

Every approve, reject, return and withdrawal action SHALL be recorded in `approval_log` and MUST NOT
be modified afterward, alongside the `ESCALATE` rows the SLA sweep writes.

A document's history SHALL therefore have no terminal outcome that leaves no row: approval,
rejection, return and withdrawal each name their actor, and a reader never has to infer who ended a
document from `document.created_by` or when from a mutable timestamp.

#### Scenario: Each action is auditable

- **GIVEN** a document that passed three approval steps
- **WHEN** its history is viewed
- **THEN** every actor, action, timestamp, and remark is present and immutable

#### Scenario: A withdrawn document's history names who ended it

- **GIVEN** a document withdrawn by its creator while in approval
- **WHEN** its history is viewed
- **THEN** the withdrawal appears as a `CANCEL` row with its actor, step, time and remark, rather
  than as a history that stops mid-route

### Requirement: Authorized, Append-Only Actions with Hold Release

Every action taken through the approval endpoint SHALL require `DOC_APPROVE`, be recorded in the
append-only `approval_log` (never modified), and carry actor, action, timestamp, and remark.

`DOC_APPROVE` gates that endpoint, not the table. A withdrawal is also recorded in `approval_log`
and is authorised by `DOC_CANCEL` on the document's own cancel endpoint, because it is the
requester ending their own request rather than a decision about somebody else's. Every writer of
that table SHALL name the permission it was authorised by, so no reader concludes from a row that
its author held `DOC_APPROVE`.

The action endpoint SHALL accept only the actions a person performs: `APPROVE`, `REJECT` and
`RETURN`. `ESCALATE` SHALL be written by the system's SLA sweep alone and SHALL be refused when it
arrives from a caller, because a row in the audit trail that reads as an automated escalation MUST
NOT be authorable by the approver it excuses. `CANCEL` SHALL likewise be refused there: a
withdrawal is not an approval decision and does not arrive through this endpoint. Refusal SHALL
happen at validation, before any `approval_log` row is written. The set of actions the routing
engine handles SHALL be exhaustive over the accepted set, so an action the engine does not act on
cannot become a history row.

On an APPROVE action the system SHALL additionally stamp `approval_log.signature_id` with the
acting user's `app_user.current_signature_id` as it stands at the moment of approval, so
the recorded signature is locked to the approval event and is unaffected by any later
signature change; when the acting user has no current signature the action SHALL still
succeed and `signature_id` SHALL be null. REJECT, RETURN and CANCEL actions SHALL NOT
stamp a signature. REJECT SHALL set the document `REJECTED` and release its reserved
budget and quota; RETURN SHALL set it `DRAFT` and release holds so the requester can revise
and resubmit.

#### Scenario: Reject releases holds

- **GIVEN** a document holding budget/quota reservations
- **WHEN** an approver rejects it
- **THEN** it becomes `REJECTED` and all reservations are released

#### Scenario: The audit trail is immutable

- **WHEN** an attempt is made to update an existing `approval_log` row
- **THEN** it is rejected (append-only)

#### Scenario: An approver cannot post an escalation

- **GIVEN** an eligible approver on a document's current step
- **WHEN** they submit the action `ESCALATE`
- **THEN** the request is refused at validation, no `approval_log` row is written, and the
  document's current step is unchanged

#### Scenario: A withdrawal cannot be posted to the approval endpoint

- **WHEN** a caller submits the action `CANCEL` to the approval endpoint
- **THEN** it is refused at validation, and the withdrawal remains reachable only through the
  document's cancel endpoint under `DOC_CANCEL`

#### Scenario: An unhandled action never becomes history

- **WHEN** an action outside the accepted set reaches the action endpoint
- **THEN** it is refused before any row is written, rather than recorded and ignored

#### Scenario: Approve stamps the approver's current signature

- **GIVEN** an approver whose `app_user.current_signature_id` references signature S1
- **WHEN** they approve the current step
- **THEN** the new `approval_log` row has `signature_id` = S1, set at insert and never updated

#### Scenario: Approve without a signature still records the action

- **GIVEN** an approver with no current signature
- **WHEN** they approve the current step
- **THEN** the approval succeeds and the `approval_log` row's `signature_id` is null

#### Scenario: Non-approve actions do not stamp a signature

- **WHEN** an approver rejects or returns, or a requester withdraws
- **THEN** the recorded `approval_log` row has a null `signature_id`
