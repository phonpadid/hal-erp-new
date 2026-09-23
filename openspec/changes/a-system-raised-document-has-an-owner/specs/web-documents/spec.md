## MODIFIED Requirements

### Requirement: Submit and Cancel

The web app SHALL let a `DOC_SUBMIT` user submit a draft and a `DOC_CANCEL` user withdraw a
document their scope covers, reflecting the resulting status. When the document type has `requires_quota = true`,
the submit call SHALL include the `quotaReservations` the requester built (each with a `quotaId` and
`qty`) in the `POST /documents/:id/submit` body; for other types the body carries no reservations.
A quota-controlled draft SHALL be submitted through the wizard, which owns the reservation state;
the document-detail Submit affordance for a `requires_quota` draft SHALL route into the wizard's
quota/review step rather than submit an empty body. Server-side submit errors (over-budget,
over-quota, no quota reservation declared, no linked employee for a personal quota, missing field,
closed period, vendor/item not enabled) SHALL be surfaced to the user.

Cancelling SHALL let the user state a reason, sent as the request's `remark` and kept on the
withdrawal's audit row. The reason SHALL be optional — a withdrawal is the author's own second
thoughts, and the act SHALL NOT be refused for want of one.

Cancelling a document that is `SUBMITTED` or `IN_APPROVAL` takes it away from people who are
holding it, so the confirmation SHALL say so rather than presenting the same prompt a draft gets.

The withdraw affordance SHALL be offered on the server's own answer to "may this reader withdraw
this document", read from the document detail, and SHALL NOT be derived by comparing the signed-in
user with the document's creator. Withdrawal is authorized by `DOC_CANCEL` at the holder's granted
scope, which the client cannot evaluate without re-implementing the scope rule and its fail-safe —
and a second implementation of an authorization rule drifts silently, hiding a control that would
have worked or offering one the server refuses. The button SHALL therefore appear exactly when the
server would accept the call, including on a document the reader did not raise.

#### Scenario: Successful submit advances status

- **WHEN** a valid draft is submitted
- **THEN** the document moves out of DRAFT and the detail reflects the new status

#### Scenario: Quota-controlled submit includes reservations

- **WHEN** a valid `requires_quota` draft is submitted from the wizard
- **THEN** the submit request carries the `quotaReservations` array and the document moves out of
  DRAFT

#### Scenario: Server submit error is shown

- **WHEN** submit is rejected by the server (e.g. over budget, over quota, or no quota reservation
  declared)
- **THEN** the error message is shown and the document stays DRAFT

#### Scenario: A reason may be given when withdrawing

- **WHEN** a `DOC_CANCEL` user withdraws their document and types a reason
- **THEN** the reason is sent as `remark` with the cancel request

#### Scenario: Withdrawing without a reason still works

- **WHEN** the user confirms the withdrawal leaving the reason empty
- **THEN** the request is sent with no `remark` and the document is withdrawn

#### Scenario: Withdrawing from approval says who it affects

- **WHEN** the user withdraws a document that is `SUBMITTED` or `IN_APPROVAL`
- **THEN** the confirmation states that it is currently with approvers, rather than showing the
  prompt used for a draft

#### Scenario: The withdraw button is offered on a document the reader did not raise

- **GIVEN** a `DRAFT` document raised by someone else, which the reader's `DOC_CANCEL` scope covers
- **WHEN** the reader opens its detail
- **THEN** the withdraw affordance is offered, and using it withdraws the document

#### Scenario: The withdraw button is withheld where the server would refuse

- **GIVEN** a `DRAFT` document the reader's `DOC_CANCEL` scope does not cover
- **WHEN** the reader opens its detail
- **THEN** no withdraw affordance is offered
