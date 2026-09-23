## MODIFIED Requirements

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

Every path that decides a document's `status` SHALL re-read `document` under a pessimistic write
lock and SHALL make its decision and its write against that locked row. This covers withdrawal and
the opening of a route as well as the approval actions that already take the lock. Routing begins
from the submit event, after the submit transaction commits, so there is a window in which a
document is `SUBMITTED` and no route has opened; a withdrawal accepted in that window and a route
opening that read `SUBMITTED` a moment earlier will otherwise both commit, and the later write
wins. A withdrawal the server accepted SHALL be the document's final state: no later write SHALL
move it out of `CANCELLED`, and a route SHALL NOT open on a document that is no longer `SUBMITTED`
when the route is written.

On an APPROVE action the system SHALL additionally stamp `approval_log.signature_id` with the
acting user's `app_user.current_signature_id` as it stands at the moment of approval, so
the recorded signature is locked to the approval event and is unaffected by any later
signature change. When the recorded step (`document_approval_step.show_signature_on_pdf`) is
flagged on and the acting user — the delegate, when acting under delegation, since theirs is the
signature that would be stamped — has no current signature, the APPROVE SHALL be refused with the
stable reason `SIGNATURE_REQUIRED` before any `approval_log` row is written, the document's
current step SHALL be unchanged, and the refusal SHALL name where a signature is uploaded. When
the recorded step is flagged off, no signature is printed for it and the APPROVE SHALL proceed
with `signature_id` null. An `approval_log` row written before this rule with a null
`signature_id` remains valid history. REJECT, RETURN and CANCEL actions SHALL NOT stamp a
signature and SHALL NOT be refused for want of one. REJECT SHALL set the document `REJECTED` and
release its reserved budget and quota; RETURN SHALL set it `DRAFT` and release holds so the
requester can revise and resubmit.

The read-only eligibility check that backs the detail view's affordances SHALL report, alongside
whether the user may act, the reason `SIGNATURE_REQUIRED` when the only thing standing between an
otherwise eligible approver and an APPROVE is a missing signature, so a client can disable Approve
while leaving Reject and Return available.

#### Scenario: Reject releases holds

- **GIVEN** a document holding budget/quota reservations
- **WHEN** an approver rejects it
- **THEN** it becomes `REJECTED` and all reservations are released

#### Scenario: A withdrawal taken before the route opens is final

- **GIVEN** a document whose submit has just committed and whose route has not yet opened
- **WHEN** its creator withdraws it
- **THEN** it is `CANCELLED`, its `approval_log` carries the `CANCEL` row, its budget hold is
  released, and the route never opens on it

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

#### Scenario: Approve without a signature is refused on a step that prints one

- **GIVEN** an eligible approver with no current signature on a step whose recorded
  `show_signature_on_pdf` is on
- **WHEN** they approve the current step
- **THEN** the request is refused with reason `SIGNATURE_REQUIRED`, no `approval_log` row is
  written, and the document stays on the same step

#### Scenario: Approve without a signature proceeds on a step that prints none

- **GIVEN** an eligible approver with no current signature on a step whose recorded
  `show_signature_on_pdf` is off
- **WHEN** they approve the current step
- **THEN** the approval succeeds and the `approval_log` row's `signature_id` is null

#### Scenario: A delegate needs their own signature

- **GIVEN** approver A has delegated to B, A has a current signature and B has none, on a step
  flagged `show_signature_on_pdf`
- **WHEN** B approves on A's behalf
- **THEN** the request is refused with `SIGNATURE_REQUIRED`, because B's signature is the one that
  would be stamped

#### Scenario: Reject and return never require a signature

- **GIVEN** an eligible approver with no current signature
- **WHEN** they reject or return the document
- **THEN** the action is recorded and the `approval_log` row's `signature_id` is null

#### Scenario: Non-approve actions do not stamp a signature

- **WHEN** an approver rejects or returns, or a requester withdraws
- **THEN** the recorded `approval_log` row has a null `signature_id`

#### Scenario: The eligibility check says why Approve is unavailable

- **GIVEN** an otherwise eligible approver with no current signature on a step flagged
  `show_signature_on_pdf`
- **WHEN** the client asks whether they may act on the document
- **THEN** the response reports that they may act and carries the reason `SIGNATURE_REQUIRED`
