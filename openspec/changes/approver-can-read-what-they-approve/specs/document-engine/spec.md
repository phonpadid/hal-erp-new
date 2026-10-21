## MODIFIED Requirements

### Requirement: A Reader Never Loses The Documents They Are Party To

A document SHALL remain visible to a user, whatever their granted scope, when any is true:

- the document records them as its `created_by`, or
- the `approval_log` records an action they took on it, or
- a live `document_approval_step` on it records them among the actors it opened for, or
- it is `IN_APPROVAL` and they are, right now, an eligible approver of its current step — exactly
  as the approval inbox and the approval actions resolve it: the step's `approver_user_id`, a
  holder of its `approver_role_id` in the document's company whose `user_company_role` is valid on
  the company's day, an active `approval_delegation` delegate of such a principal that covers the
  document's type and amount, or the step's `escalated_to_user_id`.

Raising a document is the plainest claim on it there is, and it was the one source missing. A
document's `department` is not always its creator's: a `CREATE_SUCCESSOR` pairing writes the
successor into the department the pairing names while `created_by` stays the predecessor's
requester, and a person who moves between departments leaves behind everything they raised in the
old one. In both cases a requester at `DEPARTMENT` scope lost sight of their own document. The type
gate already carries this exemption for the same reason; the party rule did not.

Approving is, by definition, work on documents other people raised in other departments. Without
this rule the correct configuration — a department head at DEPARTMENT scope — could not open the
disbursement they are being asked to sign, and the only way to make approval work would be to grant
every approver the whole company, which is the visibility this scoping exists to remove.

The recorded actors are frozen when a step opens, on purpose: a PARALLEL_ALL step must not gain a
required approval because somebody was granted the role mid-flight. But the approval inbox resolves
the role's holders live, so a person granted the role after the step opened — or every holder, when
the role had none at that moment — was listed a document to approve and answered not-found on
opening it. Whoever the system lets act on a document SHALL be able to read it: the live-eligible
source closes that gap without unfreezing the actors, so who must approve is unchanged and only who
may read is aligned with who may act.

The delegation window and the role validity window SHALL be read on the company's calendar day
(`company.timezone`), as the approval actions read them, never the server's UTC day.

The two sources are read together on purpose: `approval_log` is append-only, so a document someone
approved stays findable to them permanently, while the recorded actors make a document visible as
soon as it reaches their queue and before they have acted on it.

This rule SHALL widen visibility only. It SHALL NOT grant any action, and it SHALL NOT cross the
company boundary.

#### Scenario: An approver can open a document from another department

- **GIVEN** a user at OWN scope who is the recorded actor on the open step of a document somebody
  else raised in another department
- **WHEN** they list documents, and open that one
- **THEN** it appears in the list and its detail is readable

#### Scenario: A document stays visible after it has been approved

- **GIVEN** a user at OWN scope who approved a document a month ago
- **WHEN** they list documents
- **THEN** that document is still returned, because the log of their action is permanent

#### Scenario: Refusing a document keeps it findable too

- **GIVEN** a user at OWN scope who rejected or returned a document
- **WHEN** they list documents
- **THEN** that document is returned — the record is of the action, whatever the action was

#### Scenario: A document that has not reached the approver yet stays hidden

- **GIVEN** a user at OWN scope named on a LATER step of a document whose route has not reached
  that step
- **WHEN** they list documents
- **THEN** the document is not returned, because no step has opened for them and no action is logged

#### Scenario: Being party to a document confers no action

- **GIVEN** a user who approved a document and holds no `DOC_CANCEL`
- **WHEN** they attempt to cancel it
- **THEN** the request is refused, because visibility is not authority

#### Scenario: Involvement never crosses a company

- **GIVEN** a user whose approval history is in one company
- **WHEN** they list documents in another company they belong to
- **THEN** only that company's documents are considered, and their history elsewhere adds nothing

#### Scenario: A requester sees the successor the system raised into another department

- **GIVEN** a `CREATE_SUCCESSOR` pairing that writes its successor into department B
- **WHEN** the predecessor's requester, assigned only to department A at `DEPARTMENT` scope, reads
  the successor
- **THEN** it is visible to them, because they are recorded as its `created_by`

#### Scenario: A requester keeps the documents they raised in a former department

- **GIVEN** a user reassigned from department A to department B
- **WHEN** they read a document they raised while in department A
- **THEN** it remains visible to them

#### Scenario: Being the creator grants no action

- **GIVEN** a document visible to its creator only through this rule
- **WHEN** they attempt an act their permissions and scope do not cover
- **THEN** the act is refused, and only the read was widened

#### Scenario: A role granted after the step opened can read what it is asked to approve

- **GIVEN** a document whose current step targets role R, opened when R's only holder was A, and a
  user B at OWN scope granted R afterwards
- **WHEN** B opens their approval inbox, and opens that document
- **THEN** the document is listed and its detail is readable
- **AND** the step's recorded actors are still only A, so the approvals the step requires are
  unchanged

#### Scenario: A role that had no holders when the step opened

- **GIVEN** a document whose current step targets role R, which had no holders when the step
  opened, and a user at DEPARTMENT scope in another department granted R afterwards
- **WHEN** they open the document from their inbox
- **THEN** its detail is readable

#### Scenario: Every inbox row opens

- **GIVEN** any user and the documents the approval inbox lists for them
- **WHEN** they request each of those documents by id
- **THEN** every one is readable

#### Scenario: Live eligibility ends with the step

- **GIVEN** a user at OWN scope who could read a document only because they held the current
  step's role, and had not acted on it
- **WHEN** the route moves past that step, or their role assignment's `valid_to` passes
- **THEN** the document is no longer visible to them through this source

#### Scenario: Live eligibility does not reach a later step

- **GIVEN** a user at OWN scope who holds the role of a LATER step of a document whose route has not
  reached that step
- **WHEN** they list documents
- **THEN** the document is not returned

#### Scenario: Live eligibility stays inside the company

- **GIVEN** a user holding role R in company A and a role of the same name in company B
- **WHEN** they read documents in company A
- **THEN** only company A's documents whose current step targets company A's R are made visible

#### Scenario: A delegation window is the company's day

- **GIVEN** a company in UTC+7 and a delegation to user D ending on the 31st
- **WHEN** D reads the delegated document at 06:00 local time on the 1st (23:00 UTC on the 31st)
- **THEN** the document is no longer visible to D through the delegation
