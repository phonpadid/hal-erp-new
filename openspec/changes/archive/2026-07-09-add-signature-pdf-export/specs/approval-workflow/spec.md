## MODIFIED Requirements

### Requirement: Authorized, Append-Only Actions with Hold Release

Every approval action SHALL require `DOC_APPROVE`, be recorded in the append-only
`approval_log` (never modified), and carry actor, action, timestamp, and remark. On an
APPROVE action the system SHALL additionally stamp `approval_log.signature_id` with the
acting user's `app_user.current_signature_id` as it stands at the moment of approval, so
the recorded signature is locked to the approval event and is unaffected by any later
signature change; when the acting user has no current signature the action SHALL still
succeed and `signature_id` SHALL be null. REJECT, RETURN, and DELEGATE actions SHALL NOT
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

#### Scenario: Approve stamps the approver's current signature

- **GIVEN** an approver whose `app_user.current_signature_id` references signature S1
- **WHEN** they approve the current step
- **THEN** the new `approval_log` row has `signature_id` = S1, set at insert and never updated

#### Scenario: Approve without a signature still records the action

- **GIVEN** an approver with no current signature
- **WHEN** they approve the current step
- **THEN** the approval succeeds and the `approval_log` row's `signature_id` is null

#### Scenario: Non-approve actions do not stamp a signature

- **WHEN** an approver rejects, returns, or delegates
- **THEN** the recorded `approval_log` row has a null `signature_id`
