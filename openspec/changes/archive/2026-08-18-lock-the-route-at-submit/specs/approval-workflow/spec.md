# approval-workflow

## ADDED Requirements

### Requirement: The Route A Document Runs Is Recorded At Submit

When a document is submitted, the system SHALL resolve the steps of its bound workflow that apply
to it — by the existing amount-band and requester job-level rules — and SHALL record one
`document_approval_step` row per applicable step, before the document enters approval.

The route SHALL be written and its first step opened in ONE transaction, and the document SHALL NOT
be announced to any approver until that transaction commits, so no reader can ever see a partially
written route. The rows SHALL NOT be written inside the transaction that issues the document number
and takes the budget hold: that transaction holds the company-wide numbering lock, and every
concurrent submit queues behind it.

Each row SHALL carry, copied rather than joined: `step_no`, `step_name`, `approve_mode`,
`sla_hours`, the approver target (`approver_role_id` or `approver_user_id`),
`show_signature_on_pdf`, and a nullable `source_workflow_step_id` identifying the configuration it
came from. Once written, a row's copied values SHALL NOT be changed by any later edit to
`workflow_step`.

After a document is submitted, routing, the approval inbox, the SLA sweep, the pending-approver
read, the approval-ageing report and the PDF's signature blocks SHALL read the document's recorded
route and SHALL NOT re-derive it from `workflow_step`. Deleting or editing the configured step a
row came from SHALL NOT change that document's route; `source_workflow_step_id` SHALL become null
rather than preventing the deletion, as `approval_log.step_no` already survives a deleted step by
being a value rather than a reference.

The document SHALL continue to point at the step it waits on through `document.current_step_no`,
with `0` meaning it is not routing.

A submit that resolves no applicable step SHALL record no route and SHALL fail loudly rather than
leaving a document that can never move.

#### Scenario: The route is written when the document is submitted

- **GIVEN** a workflow whose steps 1, 2 and 3 all apply to a document
- **WHEN** the document is submitted
- **THEN** three `document_approval_step` rows exist for it, carrying each step's name, mode, SLA
  hours and approver target

#### Scenario: A step the amount band excludes is not in the route

- **GIVEN** a workflow whose final step engages only above 500,000
- **WHEN** a 400,000 document is submitted
- **THEN** that step has no row in the document's route

#### Scenario: Editing the configuration does not change a routing document

- **GIVEN** a document routing on a recorded route
- **WHEN** an administrator renames the configured step, changes its approver and its SLA
- **THEN** the document's route rows are unchanged and it continues to the approvers it had

#### Scenario: Deleting the configured step does not break the route

- **GIVEN** a document routing on a recorded route
- **WHEN** the `workflow_step` a row came from is deleted
- **THEN** the row survives with a null `source_workflow_step_id` and routing continues

#### Scenario: No approver ever sees a half-written route

- **GIVEN** a document whose route has three steps
- **WHEN** it is submitted
- **THEN** all three rows and the first step's opening commit together, and the approvers are
  notified only afterwards

#### Scenario: A failure before the route is written leaves the document loudly stranded

- **GIVEN** a submitted document whose route could not be written
- **THEN** it remains `SUBMITTED`, in nobody's inbox, and the failure is surfaced rather than
  leaving a document that appears to be routing

### Requirement: Each Step Is Timed From When It Opened

Each `document_approval_step` SHALL carry `started_at`, stamped when the step opens — at submit for
the first applicable step, and when routing advances for each one after it — and `completed_at`,
stamped when it is left.

Every elapsed-time question about a step SHALL be answered from `started_at`: the working-hour SLA
due time, whether it is overdue, and the time-in-step the approval-ageing report shows. A step's
elapsed time SHALL NOT be measured from `document.submitted_at`, because `sla_hours` is configured
per step and a step that inherits the time an earlier step spent is overdue before its approver has
seen it.

#### Scenario: A later step's clock starts when it opens

- **GIVEN** a three-step route whose steps each allow 24 working hours
- **AND** the first approver takes two days
- **WHEN** the second step opens
- **THEN** its due time is 24 working hours from that moment, and it is not overdue

#### Scenario: The first step is timed from submit

- **WHEN** a document is submitted
- **THEN** its first step's `started_at` is the submit, and its due time is measured from there

#### Scenario: Time-in-step is read, not inferred

- **WHEN** the approval-ageing report reports how long a document has sat on its current step
- **THEN** the figure comes from that step's `started_at`, not from the latest approval-log row

## MODIFIED Requirements

### Requirement: Routing Lifecycle and Step Completion

The system SHALL route a SUBMITTED document through the steps recorded on it at submit, in
`step_no` order, setting the document to `IN_APPROVAL` while routing. Step completion SHALL be
derived from `approval_log`: a SEQUENTIAL or PARALLEL_ANY step completes on the first APPROVE; a
PARALLEL_ALL step completes only when every actor recorded on that step has approved, directly or
through a delegate. When the last recorded step completes the document SHALL become `APPROVED`.

Which steps apply is decided once, at submit (see *The Route A Document Runs Is Recorded At
Submit*), and SHALL NOT be re-derived while the document routes.

#### Scenario: Amount band includes the higher step

- **GIVEN** a workflow whose final step has `amount_min` 500000
- **WHEN** a document with `base_total_amount` 600000 routes
- **THEN** that step is part of the routing; a 400000 document skips it

#### Scenario: Parallel-any advances on first approval

- **GIVEN** a PARALLEL_ANY step with three eligible approvers
- **WHEN** one approves
- **THEN** the step is satisfied and routing advances

#### Scenario: Parallel-all waits for everyone

- **GIVEN** a PARALLEL_ALL step with two eligible approvers
- **WHEN** only one has approved
- **THEN** the step is not yet complete and routing does not advance

#### Scenario: Advancing closes one step and opens the next

- **WHEN** a step completes and routing advances
- **THEN** the completed row carries `completed_at`, the next row carries `started_at`, and both
  are written in the transaction that recorded the approval

### Requirement: Step Approval Modes

Each step SHALL support SEQUENTIAL, PARALLEL_ALL, or PARALLEL_ANY approval.

The actors a PARALLEL_ALL step waits for SHALL be recorded when that step opens, and SHALL NOT
change while the step is open: a role membership granted or revoked mid-step SHALL NOT alter how
many approvals that step needs, or let it complete on an approval from someone who no longer holds
the role. Membership changes SHALL reach steps that open afterwards, which is what a membership
change is for.

Delegation SHALL remain live: the recorded actor is the principal, and who may act for them is
resolved at the moment of acting, because a delegation states who is available now.

#### Scenario: Parallel-any completes on first approval

- **GIVEN** a PARALLEL_ANY step with three eligible approvers
- **WHEN** any one approves
- **THEN** the step is satisfied and routing advances

#### Scenario: A new role holder does not join an open step

- **GIVEN** an open PARALLEL_ALL step recorded with two actors
- **WHEN** a third user is granted that role and the two recorded actors approve
- **THEN** the step completes

#### Scenario: A departed role holder still counts on an open step

- **GIVEN** an open PARALLEL_ALL step recorded with two actors
- **WHEN** one of them loses the role before approving
- **THEN** the step still waits for that actor rather than completing on the other's approval alone

#### Scenario: A delegate may act for a recorded actor

- **GIVEN** an open step recorded with actor A, who has an active delegation to B
- **WHEN** B approves
- **THEN** the approval counts for A and records `delegated_from`

### Requirement: SLA and Escalation

The system SHALL track a working-hour SLA per step computed from the recorded step's `sla_hours`
against the company `holiday_calendar` (skipping weekends and company holidays), measured from that
step's `started_at`, and SHALL run a scheduled sweep that escalates overdue `IN_APPROVAL` steps that
have no active delegation. Escalation SHALL forward the item to the next recorded step (the schema
carries no reporting/superior relationship, so superior-based escalation is out of scope) inside a
single transaction that locks the document row, notify the new eligible actor, and append an
`ESCALATE` entry to the append-only `approval_log`. Escalation MUST NOT route the item to the
document's creator (no-self-approval still holds after reassignment) and MUST NOT modify any
existing `approval_log` row.

#### Scenario: Overdue item escalates and notifies

- **GIVEN** a step whose working-hour SLA has elapsed since it opened and no active delegation exists
- **WHEN** the escalation sweep runs
- **THEN** the item is forwarded to the next recorded step, the new actor is notified, and
  an `ESCALATE` row is appended to `approval_log`

#### Scenario: A step that just opened is not overdue

- **GIVEN** a route whose earlier step consumed more than the whole SLA
- **WHEN** the next step opens and the sweep runs
- **THEN** it is not escalated, because its own clock has just started

#### Scenario: Working-day computation skips holidays

- **GIVEN** a step opened before a weekend and a company holiday
- **WHEN** the SLA due time is computed from `sla_hours`
- **THEN** weekends and the company's `holiday_calendar` dates are excluded from the elapsed
  working hours

#### Scenario: Escalation never targets the creator

- **GIVEN** an overdue step whose superior is the document's creator
- **WHEN** the escalation sweep runs
- **THEN** the creator is skipped and the item escalates to the next eligible actor instead

#### Scenario: Active delegation suppresses escalation

- **GIVEN** an overdue step whose approver has an active delegation covering the document
- **WHEN** the escalation sweep runs
- **THEN** the item is left for the delegate and is not escalated

### Requirement: Reject Returns and Releases

On rejection the system SHALL set the document to REJECTED, release reserved budget
and quota, and allow the requester to revise and resubmit.

A resubmission SHALL resolve and record a fresh route from the configuration in force at that
moment, and SHALL mark the previous route's rows superseded rather than deleting them, so each
attempt keeps the record of the chain it actually ran.

When the rejected document is a budget plan (`post_action` `ACTIVATE_BUDGET`), rejection SHALL
additionally set every `budget` referenced by the document's `budget_movement` rows from `DRAFT` to
`REJECTED`, in the same transaction as the terminal transition. Nothing is released for such a
document: a plan's type has `requires_budget` `false`, so it never held a reservation. The rows are
marked rather than deleted — `budget_movement.to_budget_id` references them, and the record of what
was proposed and turned down is the reason budgets are routed through approval at all.

#### Scenario: Rejected document can be resubmitted

- **GIVEN** a rejected document
- **WHEN** the requester edits and resubmits it
- **THEN** it re-enters routing from the first step with a fresh reservation

#### Scenario: A resubmission is routed by current configuration

- **GIVEN** a returned document whose workflow gained a step while it was in `DRAFT`
- **WHEN** it is resubmitted
- **THEN** its new route includes that step, and the superseded route still shows the chain the
  first attempt ran

#### Scenario: Rejecting a budget plan marks its proposed budgets REJECTED

- **GIVEN** a submitted budget plan carrying `DRAFT` budgets
- **WHEN** an approver rejects it
- **THEN** every budget the plan references has `status` `REJECTED` in the same transaction that
  marks the document `REJECTED`
- **AND** no budget release row is written

### Requirement: Workflow and Step Configuration Mutations

The system SHALL let a `WORKFLOW_MANAGE` user, scoped to the active company, create, update and
delete workflows and their steps, so approval routing can be maintained after creation.

Updating a workflow SHALL allow changing its `name` and its `isActive` state. Deactivating a
workflow SHALL only remove it from selection for new documents and SHALL NOT alter the routing of
documents already in progress. A workflow update SHALL NOT affect the append-only approval audit
trail.

Deleting a workflow SHALL be rejected when any department mapping (`dept_doc_type`) references
it, or when any document references it; the rejection SHALL identify the reason. When no such
reference exists, deleting a workflow SHALL remove the workflow together with its steps in a
single transaction.

Creating a step SHALL resolve `workflow_step.workflow_id` by a query scoped to the active company
and SHALL refuse a workflow of another company as not-found. It SHALL NOT write the foreign key
from the supplied id without resolving it, because an unresolved reference bypasses company
isolation entirely (invariant 1).

Creating or updating a step SHALL resolve `workflow_step.approver_role_id` against the active
company's `role` rows and `workflow_step.approver_user_id` against the users holding a role in the
active company (`user_company_role`), and SHALL refuse a target belonging to another company with
an error naming the offending field. A step SHALL NOT be configured with a principal that
approver resolution could never produce.

Creating, updating or deleting a step SHALL be permitted while the workflow has documents in
approval. Routing reads the route recorded on each document, so a configuration edit reaches
documents submitted afterwards and cannot reach one already routing. The system SHALL NOT refuse a
step mutation on the grounds that a document is in flight: that refusal existed only because
routing re-derived the step set, and a company whose documents are always in flight could never
maintain its workflows.

A step create or update SHALL enforce the step validation rules (the amount range MUST satisfy
`amountMin` ≤ `amountMax`, and `stepNo` MUST remain unique within the workflow). Each operation
SHALL perform its resolution, its guards and its write inside one database transaction. Deleting a
step SHALL NOT modify the append-only `approval_log`, which records `stepNo` as a value rather than
a reference.

All operations SHALL enforce the `WORKFLOW_MANAGE` permission code and the active-company scope; a
workflow or step in another company SHALL NOT be created into, updated or deleted.

#### Scenario: Update a workflow's name and active state

- **WHEN** a `WORKFLOW_MANAGE` user updates a workflow's name and toggles `isActive`
- **THEN** the workflow reflects the new name and active state, and documents already routing
  through it are unaffected

#### Scenario: Deleting a mapped workflow is rejected

- **WHEN** the user tries to delete a workflow that a `dept_doc_type` mapping references
- **THEN** the deletion is rejected with a reason and the workflow is preserved

#### Scenario: Deleting a referenced workflow is rejected

- **WHEN** the user tries to delete a workflow that any document references
- **THEN** the deletion is rejected with a reason and the workflow is preserved

#### Scenario: Delete an orphan workflow with its steps

- **WHEN** the user deletes a workflow that no mapping and no document references
- **THEN** the workflow and its steps are removed together

#### Scenario: A step cannot be added to another company's workflow

- **GIVEN** a `WORKFLOW_MANAGE` user whose active company is A
- **WHEN** they add a step naming a `workflow_id` belonging to company B
- **THEN** the request is refused as not-found and no `workflow_step` row is written

#### Scenario: A step cannot name an approver from another company

- **GIVEN** a `WORKFLOW_MANAGE` user whose active company is A
- **WHEN** they create or update a step naming an `approver_role_id` or `approver_user_id` that
  belongs to company B
- **THEN** the request is refused with an error naming that field and the step is unchanged

#### Scenario: A step may be edited while a document is in flight

- **GIVEN** a workflow with a document in `IN_APPROVAL`
- **WHEN** the user edits, adds or deletes a step of that workflow
- **THEN** the operation succeeds, and the in-flight document's recorded route is unchanged

#### Scenario: Edit a step when no document is in-flight

- **WHEN** the user edits a step of a workflow with no in-flight document, giving a valid
  amount range and a `stepNo` unique within the workflow
- **THEN** the step is updated

#### Scenario: Delete a step preserves approval history

- **WHEN** the user deletes a step of a workflow
- **THEN** the step is removed and existing `approval_log` rows (which store `stepNo` as a
  value) are unchanged

#### Scenario: Company scope on mutation

- **WHEN** a user attempts to create into, update or delete a workflow or step belonging to
  another company
- **THEN** the operation is not applied
