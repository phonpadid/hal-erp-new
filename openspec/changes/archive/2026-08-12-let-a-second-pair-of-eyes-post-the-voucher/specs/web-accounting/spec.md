# web-accounting

## ADDED Requirements

### Requirement: The Voucher Screen Submits For Approval

The journal voucher form SHALL submit a voucher for approval rather than posting it, and SHALL say
so — a form whose button reads "post" when it does not post is worse than one that asks for a
second person.

A pending-vouchers screen SHALL list what is awaiting approval, gated by `GL_VIEW`, with approve and
reject controls shown only to holders of `GL_JV_APPROVE`, and rejection SHALL require a reason
before its control is enabled.

The screen SHALL NOT hide the approve control on a viewer's own voucher; the server refuses
self-approval and its refusal is the one that matters. It MAY mark it.

#### Scenario: The form says it is submitting, not posting

- **WHEN** a `GL_JV_POST` holder completes a balanced voucher
- **THEN** the control offers to submit it for approval

#### Scenario: Approval controls appear only with the approval code

- **GIVEN** a user holding `GL_VIEW` without `GL_JV_APPROVE`
- **WHEN** the pending vouchers render
- **THEN** no approve or reject control is offered

#### Scenario: Rejecting needs a reason

- **GIVEN** a user holding `GL_JV_APPROVE` opening the reject dialog
- **WHEN** no reason has been entered
- **THEN** the confirm control is disabled
