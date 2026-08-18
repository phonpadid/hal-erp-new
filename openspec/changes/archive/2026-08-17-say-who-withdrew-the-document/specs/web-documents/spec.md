# web-documents

## MODIFIED Requirements

### Requirement: Submit and Cancel

The web app SHALL let a `DOC_SUBMIT` user submit a draft and a `DOC_CANCEL` user cancel an
own document, reflecting the resulting status. When the document type has `requires_quota = true`,
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

## ADDED Requirements

### Requirement: Every Recorded Action Renders In The Detail Timeline

Every action the server can write to `approval_log` SHALL have a label in each supported locale, an
icon and a severity in the detail view's timeline. A row whose action the renderer does not
recognise SHALL NOT appear as an unlabelled entry: an unreadable history is worse than the silence
the record was added to remove.

A withdrawal SHALL render like any other act — its actor, when it happened, and its remark.

#### Scenario: A withdrawal appears in the timeline

- **GIVEN** a document whose history contains a `CANCEL` row
- **WHEN** the detail view renders
- **THEN** the timeline shows the withdrawal with its actor, time and remark, labelled in the
  active locale

#### Scenario: Every recorded action is labelled

- **WHEN** the timeline renders a history containing each action the server writes
- **THEN** none of the entries renders without a label
