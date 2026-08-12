# web-accounting

## MODIFIED Requirements

### Requirement: The Voucher Screen Submits For Approval

The journal voucher form SHALL submit a voucher for approval rather than posting it, and SHALL say
so — a form whose button reads "post" when it does not post is worse than one that asks for a second
person. On success it SHALL name the document number the voucher was given, so the author can follow
it through the approval route.

A pending-vouchers screen SHALL list what is awaiting approval, gated by `GL_VIEW`, with approve and
reject controls shown only to holders of `GL_JV_APPROVE`, and rejection SHALL require a reason before
its control is enabled.

The screen SHALL show, for each voucher, the step it is waiting on. A voucher can require more than
one approval, so "pending" alone no longer tells an approver whether they are the one being waited
for.

The screen SHALL NOT hide the approve control on a viewer's own voucher; the server refuses
self-approval and its refusal is the one that matters. It MAY mark it.

#### Scenario: The form says it is submitting, not posting

- **WHEN** a `GL_JV_POST` holder completes a balanced voucher
- **THEN** the control offers to submit it for approval

#### Scenario: A submitted voucher reports its document number

- **WHEN** a voucher is submitted successfully
- **THEN** the confirmation names the document number it was given

#### Scenario: Approval controls appear only with the approval code

- **GIVEN** a user holding `GL_VIEW` without `GL_JV_APPROVE`
- **WHEN** the pending vouchers render
- **THEN** no approve or reject control is offered

#### Scenario: The waiting step is shown

- **GIVEN** a voucher waiting at the second step of its route
- **WHEN** the pending vouchers render
- **THEN** that step is shown on its row

#### Scenario: Rejecting needs a reason

- **GIVEN** a user holding `GL_JV_APPROVE` opening the reject dialog
- **WHEN** no reason has been entered
- **THEN** the confirm control is disabled
