## MODIFIED Requirements

### Requirement: Withdrawing A Document Is Recorded As An Act

Withdrawing a document SHALL append a `CANCEL` row to `approval_log` naming the acting user, the
`step_no` the document had reached, the moment it happened, and an optional remark supplied with the
request. The row SHALL be written in the same database transaction as the `CANCELLED` status
transition, so a withdrawn document and the record of who withdrew it commit together or not at all.

A withdrawal from `DRAFT` SHALL be recorded with `step_no` `0` — the value `document.current_step_no`
carries until routing starts. `approval_log.step_no` is non-null, and `0` already means "no step
reached".

The row SHALL NOT carry a signature, as `REJECT` and `RETURN` do not. The withdrawal SHALL remain
restricted to the `DRAFT`, `SUBMITTED` and `IN_APPROVAL` statuses, and SHALL continue to release
every budget, quota and stock hold (invariant 4, invariant 5).

Withdrawal SHALL be authorized by the `DOC_CANCEL` permission code applied at the holder's granted
scope, and SHALL NOT be restricted to the document's creator. `OWN` SHALL permit only documents the
caller raised; `DEPARTMENT` SHALL permit documents belonging to a department the caller is assigned
to; `COMPANY` SHALL permit any document of the active company. An ungranted code SHALL collapse to
`OWN`, the narrowest rule. A caller whose scope does not cover the document SHALL be refused and the
document SHALL be left unchanged.

The creator rule could not survive a document the system raises. A `CREATE_SUCCESSOR` pairing that
names a successor department produces a document whose `created_by` is the PREDECESSOR's requester —
a person in another department — while its `department` is the successor's. Withdrawal then belonged
to someone who, at `DEPARTMENT` scope, could not even see the document, and the department that owned
the work could see it and had no way to withdraw it. Neither party held both halves, and a duplicate
draft could be removed by nobody.

This SHALL NOT widen what a withdrawal does, nor who may approve, reject or return.

A withdrawal SHALL NOT cross the company boundary at any scope. The document a withdrawal names MUST
belong to the active company, and one that does not SHALL be reported as not found rather than
refused, so a cross-company id is never confirmed to exist. This is stated rather than inherited:
the withdrawal reads its row with the company filter disabled in order to lock it, so `COMPANY`
scope — which narrows by nothing — would otherwise reach another company's documents.

Withdrawing an already-`CANCELLED` document SHALL remain a no-op: exactly one `CANCEL` row exists per
withdrawal, so a retried request does not write a second.

The system SHALL emit a `document.cancelled` event after the transaction commits, carrying the
document, the requester and the step it was withdrawn from, so notification and any later capability
can react to a withdrawal as they react to a rejection.

#### Scenario: Withdrawing a routing document records who did it

- **GIVEN** a document in `IN_APPROVAL` at step 2
- **WHEN** its creator withdraws it with the remark "raised against the wrong budget"
- **THEN** the document is `CANCELLED`, and one `approval_log` row exists with action `CANCEL`,
  the creator as actor, `step_no` 2, and that remark

#### Scenario: The record and the status are one transaction

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** it is withdrawn
- **THEN** no state exists in which the document is `CANCELLED` and its `CANCEL` row is absent

#### Scenario: A withdrawn draft is recorded at step zero

- **GIVEN** a `DRAFT` document that has never routed
- **WHEN** its creator withdraws it
- **THEN** a `CANCEL` row is written with `step_no` `0`

#### Scenario: The remark is optional

- **WHEN** a document is withdrawn with no remark
- **THEN** the `CANCEL` row is written with a null remark and the withdrawal succeeds

#### Scenario: No signature is stamped

- **WHEN** a document is withdrawn
- **THEN** the `CANCEL` row's `signature_id` is null

#### Scenario: Withdrawing twice writes one row

- **GIVEN** an already-`CANCELLED` document
- **WHEN** the withdrawal is requested again
- **THEN** the request succeeds, and `approval_log` still holds exactly one `CANCEL` row for it

#### Scenario: Holds are still released

- **GIVEN** a withdrawn document that held budget and quota reservations
- **WHEN** the withdrawal completes
- **THEN** every reservation is released, as it was before this act was recorded

#### Scenario: The withdrawal is announced

- **WHEN** a document is withdrawn
- **THEN** a `document.cancelled` event is emitted after commit, carrying the document, the
  requester and the step it was withdrawn from

#### Scenario: The owning department withdraws a document the system raised

- **GIVEN** a `DRAFT` successor created by a `CREATE_SUCCESSOR` pairing into department B, whose
  `created_by` is the predecessor's requester in department A
- **WHEN** a caller assigned to department B holding `DOC_CANCEL` at `DEPARTMENT` scope withdraws it
- **THEN** the withdrawal is accepted and the `CANCEL` row names that caller, not the creator

#### Scenario: A caller at OWN scope keeps exactly the old rule

- **GIVEN** a `DRAFT` document raised by another person
- **WHEN** a caller holding `DOC_CANCEL` at `OWN` scope withdraws it
- **THEN** the request is refused and the document is unchanged

#### Scenario: A caller at OWN scope may still withdraw their own

- **GIVEN** a `DRAFT` document the caller raised
- **WHEN** that caller, holding `DOC_CANCEL` at `OWN` scope, withdraws it
- **THEN** the withdrawal is accepted

#### Scenario: Another department's document is out of reach at DEPARTMENT scope

- **GIVEN** a `DRAFT` document belonging to department B
- **WHEN** a caller assigned only to department A, holding `DOC_CANCEL` at `DEPARTMENT` scope,
  withdraws it
- **THEN** the request is refused and the document is unchanged

#### Scenario: An ungranted code collapses to the narrowest rule

- **GIVEN** a caller holding no `DOC_CANCEL` grant
- **WHEN** they withdraw a document raised by someone else
- **THEN** the request is refused

#### Scenario: COMPANY scope stops at the company boundary

- **GIVEN** a `DRAFT` document of company A
- **WHEN** a caller whose active company is B, holding `DOC_CANCEL` at `COMPANY` scope, withdraws it
- **THEN** the document is reported as not found and is left unchanged

#### Scenario: Scope does not widen which statuses may be withdrawn

- **GIVEN** a `COMPLETED` document of the caller's own company
- **WHEN** a caller holding `DOC_CANCEL` at `COMPANY` scope withdraws it
- **THEN** the request is refused

#### Scenario: A withdrawal by a non-creator still releases the holds

- **GIVEN** an `IN_APPROVAL` document that reserved budget at submit
- **WHEN** a caller other than its creator withdraws it within scope
- **THEN** the reserved budget is released and the quota reservations are released

### Requirement: A Reader Never Loses The Documents They Are Party To

A document SHALL remain visible to a user, whatever their granted scope, when any is true:

- the document records them as its `created_by`, or
- the `approval_log` records an action they took on it, or
- a live `document_approval_step` on it records them among the actors it opened for.

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
