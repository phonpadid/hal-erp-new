# Approval Workflow Specification

## Purpose
Configurable, multi-step approval routing with conditions, parallel modes,
delegation during absence, SLA escalation, and a complete audit trail.
## Requirements
### Requirement: Conditional Workflow Selection

The system SHALL bind a document to the workflow mapped to its company, department, and
document type, and SHALL include a step in routing only when the step's conditions match the
document. Step inclusion SHALL honour the step's `amount_min`/`amount_max` band against the
document's `base_total_amount`, AND a step's `workflow_step.condition_json` job-level
restriction (e.g. `{ "jobLevels": ["MANAGER"] }`) against the requester's `employee.job_level`.
A step with no job-level restriction SHALL apply to every requester. When a step restricts
job levels and the requester's `job_level` is among them, the step SHALL be included; when the
requester's `job_level` is present but not among them, that step SHALL be skipped.

A workflow is *level-gated* when at least one of its steps carries a non-empty `jobLevels`
restriction in `workflow_step.condition_json`. When a document is submitted into a level-gated
workflow and the requester has no `employee.job_level` (the requester has no linked `employee`,
or the linked `employee.job_level` is null or empty), the system SHALL reject the submit with a
clear error naming the missing job level, leave the document `DRAFT`, create no budget or quota
holds, and start no routing. The requester's missing `job_level` SHALL NOT silently skip
level-gated steps. When the bound workflow is not level-gated, a requester without a `job_level`
SHALL submit normally.

#### Scenario: Amount picks the longer chain

- **GIVEN** a chain whose final step has `amount_min` 500,000
- **WHEN** a document with base amount 600,000 is submitted
- **THEN** that step is included in the routing and a 400,000 document skips it

#### Scenario: Position level gates a step

- **GIVEN** a step whose `condition_json` restricts `jobLevels` to "MANAGER"
- **WHEN** a document is submitted by a requester whose `employee.job_level` is "STAFF"
- **THEN** that step is skipped, and a document from a "MANAGER" requester includes it

#### Scenario: Unrestricted step applies to everyone

- **WHEN** a step has no job-level restriction in its `condition_json`
- **THEN** it is included regardless of the requester's `job_level`

#### Scenario: Missing job level blocks submit into a level-gated workflow

- **GIVEN** a bound workflow with at least one step restricting `jobLevels`
- **AND** a requester whose `employee.job_level` is null or empty (or who has no linked `employee`)
- **WHEN** the document is submitted
- **THEN** the submit is rejected with an error naming the missing job level, the document remains
  `DRAFT`, and no budget/quota holds or routing are created

#### Scenario: Missing job level does not block a non-level-gated workflow

- **GIVEN** a bound workflow whose steps carry no `jobLevels` restriction
- **AND** a requester whose `employee.job_level` is null or empty
- **WHEN** the document is submitted
- **THEN** the submit proceeds normally and routing starts over the applicable steps

### Requirement: Step Approval Modes
Each step SHALL support SEQUENTIAL, PARALLEL_ALL, or PARALLEL_ANY approval.

#### Scenario: Parallel-any completes on first approval
- GIVEN a PARALLEL_ANY step with three eligible approvers
- WHEN any one approves
- THEN the step is satisfied and routing advances

### Requirement: Approver by Role or Person
A step SHALL target either a company role (`approver_role_id`) or a specific user
(`approver_user_id`).

#### Scenario: Role-based step resolves current holder
- GIVEN a step targeting the "Department Head" role
- WHEN routing reaches that step
- THEN the current holder of that role in the document's department is assigned

### Requirement: Delegation During Absence
The system SHALL honor active `approval_delegation` records, routing pending items to
the delegate within the delegation's amount limit and document-type scope.

#### Scenario: Pending items go to the delegate
- GIVEN an approver with an active delegation to a colleague for this date range
- WHEN a document enters that approver's step
- THEN the colleague receives the task
- AND the approval is logged with `delegated_from` set to the original approver

### Requirement: Delegation Safeguards
The system MUST prevent chained delegation and MUST prevent anyone from approving a
document they created, including via delegation.

#### Scenario: Self-approval is blocked
- GIVEN a user who is the requester of a document
- WHEN that user is also the assigned approver or delegate for it
- THEN the system MUST block their approval and escalate or reassign

### Requirement: SLA and Escalation

The system SHALL track a working-hour SLA per step computed from `workflow_step.sla_hours`
against the company `holiday_calendar` (skipping weekends and company holidays), and SHALL
run a scheduled sweep that escalates overdue `IN_APPROVAL` steps that have no active
delegation. Escalation SHALL forward the item to the next applicable step (the schema carries
no reporting/superior relationship, so superior-based escalation is out of scope) inside a
single transaction that locks the document row, notify the new eligible actor, and append an
`ESCALATE` entry to the append-only `approval_log`. Escalation MUST NOT route the item to the
document's creator (no-self-approval still holds after reassignment) and MUST NOT modify any
existing `approval_log` row.

#### Scenario: Overdue item escalates and notifies

- **GIVEN** a step whose working-hour SLA has elapsed and no active delegation exists
- **WHEN** the escalation sweep runs
- **THEN** the item is forwarded to the next applicable step, the new actor is notified, and
  an `ESCALATE` row is appended to `approval_log`

#### Scenario: Working-day computation skips holidays

- **GIVEN** a step submitted before a weekend and a company holiday
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

#### Scenario: Rejected document can be resubmitted
- GIVEN a rejected document
- WHEN the requester edits and resubmits it
- THEN it re-enters routing from the first step with a fresh reservation

### Requirement: Append-Only Audit Trail
Every approve, reject, return, or delegate action SHALL be recorded in
`approval_log` and MUST NOT be modified afterward.

#### Scenario: Each action is auditable
- GIVEN a document that passed three approval steps
- WHEN its history is viewed
- THEN every actor, action, timestamp, and remark is present and immutable

### Requirement: Post-Action Engine
On full approval the system SHALL execute the type's `post_action` and MUST retry on
failure rather than leaving the document stuck.

#### Scenario: Failed post-action retries
- GIVEN an approved promotion whose payroll update fails transiently
- WHEN the post-action runs
- THEN it is retried and the document is not left in an inconsistent state

### Requirement: Routing Lifecycle and Step Completion

The system SHALL route a SUBMITTED document through the applicable steps of its bound
workflow — those whose `amount_min`/`amount_max` band contains the document's
`base_total_amount` — in `step_no` order, setting the document to `IN_APPROVAL` while
routing. Step completion SHALL be derived from `approval_log`: a SEQUENTIAL or
PARALLEL_ANY step completes on the first APPROVE; a PARALLEL_ALL step completes only when
every eligible approver has approved. When the last applicable step completes the document
SHALL become `APPROVED`.

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

### Requirement: Delegation and Self-Approval Enforcement

A step approver SHALL be resolved from `approver_user_id` or the holders of
`approver_role_id` in the document's company. An active `approval_delegation` (date range,
document-type scope, amount limit) SHALL reroute the item to the delegate, recording
`delegated_from`. The system MUST block an approval when the acting user — or the
delegator they act for — is the document's creator (no self-approval, directly or via
delegation), and MUST NOT follow a delegate's own delegation (no chaining).

#### Scenario: Pending item routes to the delegate

- **GIVEN** an approver with an active delegation to a colleague
- **WHEN** the document enters that approver's step
- **THEN** the colleague may approve, and the log records `delegated_from` = the approver

#### Scenario: The creator cannot approve their own document

- **WHEN** the document's creator is the assigned approver (directly or as a delegate)
- **THEN** their approval is blocked

#### Scenario: Delegation does not chain

- **GIVEN** A delegates to B and B delegates to C
- **WHEN** an item in A's step is routed
- **THEN** B may act but C is not reached through A→B→C

### Requirement: Authorized, Append-Only Actions with Hold Release

Every approval action SHALL require `DOC_APPROVE`, be recorded in the append-only
`approval_log` (never modified), and carry actor, action, timestamp, and remark. REJECT
SHALL set the document `REJECTED` and release its reserved budget and quota; RETURN SHALL
set it `DRAFT` and release holds so the requester can revise and resubmit.

#### Scenario: Reject releases holds

- **GIVEN** a document holding budget/quota reservations
- **WHEN** an approver rejects it
- **THEN** it becomes `REJECTED` and all reservations are released

#### Scenario: The audit trail is immutable

- **WHEN** an attempt is made to update an existing `approval_log` row
- **THEN** it is rejected (append-only)

### Requirement: Post-Action Execution on Full Approval

On full approval the system SHALL run the document type's `post_action` atomically with
the terminal transition and a bounded retry, then mark the document `COMPLETED`. A
`CUT_BUDGET` action SHALL convert reservations to actuals (`settle`) AND signal payment-ready
(emit a `payment.ready` event for the settled document); `TRANSFER` /
`ADJUST_INCREASE` / `ADJUST_DECREASE` SHALL execute the document's `budget_movement`; a
`CREATE_PO` action SHALL create a DRAFT successor purchase order from the approved document
(resolving the successor type by reverse `REF_CHAIN` lookup and reusing `createFrom`), and
SHALL be a logged no-op when no single successor type resolves. If the post-action ultimately
fails the terminal transition SHALL roll back, leaving the document not stuck (still routable),
never half-applied.

#### Scenario: Budget document settles on approval

- **GIVEN** an approved `CUT_BUDGET` document that reserved 100000 on a budget
- **WHEN** the post-action runs
- **THEN** an ACTUAL is recorded, the reservation is converted, and a `payment.ready` signal is emitted

#### Scenario: CREATE_PO auto-creates a draft purchase order

- **GIVEN** an approved PR whose type `post_action` is `CREATE_PO` and whose code maps to a single
  successor type (`PO`) via the reference chain
- **WHEN** the post-action runs
- **THEN** a DRAFT `PO` document referencing the PR is created (vendor, currency, and lines copied)

#### Scenario: CREATE_PO with no resolvable successor is a no-op

- **GIVEN** an approved document whose type resolves to no single successor type
- **WHEN** the `CREATE_PO` post-action runs
- **THEN** it does nothing (logged) and the approval still completes

#### Scenario: A failing post-action does not half-apply

- **WHEN** the post-action throws after retries
- **THEN** the APPROVED/COMPLETED transition is rolled back and no partial ledger effect remains

### Requirement: Approval Inbox Query

The system SHALL provide a read of the documents a user may currently act on: the active
company's `IN_APPROVAL` documents whose current step lists the user as an eligible actor
(targeted user, or a holder of the targeted role, or that principal's active one-hop
delegate) and that the user did not create. The query SHALL apply the same eligibility and
self-approval rules as acting, so it never lists a document the user cannot actually act on.
The read SHALL require `DOC_APPROVE` and be scoped to the active company.

#### Scenario: Lists only actionable documents

- **WHEN** a `DOC_APPROVE` user requests their pending approvals
- **THEN** the response contains the active company's `IN_APPROVAL` documents for which they
  are an eligible actor on the current step

#### Scenario: Excludes own and non-actionable documents

- **WHEN** the pending list is built
- **THEN** documents the user created, and documents not `IN_APPROVAL` or not targeting the
  user's role/delegation, are excluded

### Requirement: Auto-Start Routing on Submit

When a document is submitted and its mapped workflow has applicable steps, the system SHALL
begin approval routing automatically (transition `SUBMITTED` → `IN_APPROVAL` at the first
applicable step) so it appears in the relevant approvers' inboxes without a manual start.
This SHALL be triggered by the submit event so document handling does not depend on the
approval module. If no applicable step exists, the document SHALL remain `SUBMITTED`.

#### Scenario: Submit routes into approval

- **WHEN** a document with a mapped, applicable workflow is submitted
- **THEN** it transitions to `IN_APPROVAL` at the first step and its approvers can see it

#### Scenario: No workflow leaves it submitted

- **WHEN** a submitted document has no applicable workflow step
- **THEN** it remains `SUBMITTED` and no routing occurs

### Requirement: Workflow Read Surface

The system SHALL provide a read, under `WORKFLOW_MANAGE` and scoped to the active company, of the
company's workflows each with their steps (step number, approver role or user, amount range,
approval mode, SLA hours), so the configuration UI can show and extend routing.

#### Scenario: List workflows with steps

- **WHEN** a `WORKFLOW_MANAGE` user requests the workflows
- **THEN** the active company's workflows are returned, each with its ordered steps

### Requirement: Delegation Listing and Revocation

The system SHALL let a `WORKFLOW_MANAGE` user list the active company's approval delegations and
cancel a delegation. Cancelling SHALL set its status so the approver resolver no longer applies it
(it honors only active delegations), while preserving the record. Both operations SHALL be scoped
to the active company. The one-hop / no-chaining rule is unchanged — it remains enforced by the
resolver at act time, not by this configuration surface.

#### Scenario: List delegations for the active company

- **WHEN** a `WORKFLOW_MANAGE` user requests the delegations
- **THEN** the active company's delegations are returned (and not those of another company)

#### Scenario: Cancelling stops a delegation from applying

- **WHEN** a `WORKFLOW_MANAGE` user cancels an active delegation
- **THEN** its status is no longer active and the resolver does not apply it to subsequent
  approvals

### Requirement: HR Post-Actions Apply Personnel Changes

On full approval the system SHALL apply the HR post-actions to the document's `related_employee`,
atomically with the terminal transition and inside the post-action's bounded retry. An
`UPDATE_EMPLOYEE` post-action SHALL read the document's field values for the new `position`,
`salary`, and `job_level` (well-known field names) and apply the present ones to the employee,
recording the document's `effective_date` field. A `TERMINATE_EMPLOYEE` post-action SHALL set the
employee `status` to `RESIGNED` and expire that company's `user_company_role` rows for the linked
user as of the `effective_date`. When the document has no `related_employee` the post-action SHALL be
a logged no-op. If the apply fails after retries the APPROVED/COMPLETED transition SHALL roll back so
the employee is never half-changed.

#### Scenario: Promotion updates position and salary on approval

- **GIVEN** an approved `UPDATE_EMPLOYEE` document for an employee, with field values for a new
  position and salary
- **WHEN** the post-action runs
- **THEN** the employee's `position` and `salary` are updated and the effective date is recorded

#### Scenario: Resignation closes the employee and revokes company access

- **GIVEN** an approved `TERMINATE_EMPLOYEE` document for an employee linked to a user
- **WHEN** the post-action runs
- **THEN** the employee `status` becomes `RESIGNED` and that company's `user_company_role` rows are
  expired as of the effective date, while the shared `app_user` and other companies are untouched

#### Scenario: Missing related employee is a no-op

- **WHEN** an HR post-action runs on a document with no `related_employee`
- **THEN** it does nothing (logged) and the approval still completes

#### Scenario: A failing HR apply rolls back

- **WHEN** the HR apply throws after retries (e.g. an unparseable salary)
- **THEN** the APPROVED/COMPLETED transition rolls back and the employee is unchanged

### Requirement: Workflow and Step Configuration Mutations

The system SHALL let a `WORKFLOW_MANAGE` user, scoped to the active company, update and delete
workflows and their steps, so approval routing can be maintained after creation.

Updating a workflow SHALL allow changing its `name`, its selection condition (`conditionJson`),
and its `isActive` state. Deactivating a workflow SHALL only remove it from selection for new
documents and SHALL NOT alter the routing of documents already in progress. A workflow update
SHALL NOT affect the append-only approval audit trail.

Deleting a workflow SHALL be rejected when any department mapping (`dept_doc_type`) references
it, or when any document references it; the rejection SHALL identify the reason. When no such
reference exists, deleting a workflow SHALL remove the workflow together with its steps in a
single transaction.

Updating or deleting a step SHALL be rejected while the step's workflow has any document in a
non-terminal state (`SUBMITTED` or `IN_APPROVAL`), because routing reads the live step set;
otherwise the operation SHALL be applied. A step update SHALL preserve the step validation rules
(the amount range MUST satisfy `amountMin` ≤ `amountMax`, and `stepNo` MUST remain unique within
the workflow). Deleting a step SHALL NOT modify the append-only `approval_log`, which records
`stepNo` as a value rather than a reference.

All four operations SHALL enforce the `WORKFLOW_MANAGE` permission code and the active-company
scope; a workflow or step in another company SHALL NOT be updated or deleted.

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

#### Scenario: Editing a step is rejected while a document is in-flight

- **WHEN** the user edits a step of a workflow that has a document in `SUBMITTED` or
  `IN_APPROVAL`
- **THEN** the edit is rejected and the step is unchanged

#### Scenario: Edit a step when no document is in-flight

- **WHEN** the user edits a step of a workflow with no in-flight document, giving a valid
  amount range and a `stepNo` unique within the workflow
- **THEN** the step is updated

#### Scenario: Delete a step preserves approval history

- **WHEN** the user deletes a step of a workflow with no in-flight document
- **THEN** the step is removed and existing `approval_log` rows (which store `stepNo` as a
  value) are unchanged

#### Scenario: Company scope on mutation

- **WHEN** a user attempts to update or delete a workflow or step belonging to another company
- **THEN** the operation is not applied

### Requirement: Pending-Step Approver Read

The system SHALL expose a read-only projection of the approvers a document is currently waiting
on. For a document whose status is `IN_APPROVAL`, the read SHALL identify the applicable step
whose `step_no` equals the document's `current_step_no` and return that step's `step_no`,
`step_name`, `approve_mode`, and the list of eligible actors resolved by the same rules the
router uses — the targeted user, or the validity-dated holders of the targeted role, plus active
one-hop delegates (invariant 8; delegation SHALL NOT be chained). Each actor SHALL be returned
as its user id and a display name, with the principal identified when the actor is a delegate.
When the step targets a role, the read SHALL also return the role name alongside the expanded
holder list. For a document not in approval, the read SHALL return an empty/absent pending
result rather than an error.

Visibility SHALL require `DOC_VIEW` and the active-company scope, AND SHALL be limited to
participants of the document: the document's creator, or a user who is an eligible approver in
any applicable step of the document's workflow. A non-participant request SHALL be rejected as
not found. The read SHALL NOT change who may act on the document.

#### Scenario: Requester sees who the document is waiting on

- **GIVEN** a document the caller created that is `IN_APPROVAL` at step 1
- **WHEN** the caller requests the pending-step approvers
- **THEN** step 1's number, name, `approve_mode`, and its eligible approvers (user id + name)
  are returned

#### Scenario: Role-targeted step returns role name and expanded holders

- **GIVEN** the current step targets a company role held by two users
- **WHEN** a participant requests the pending-step approvers
- **THEN** the response includes the role name and both holders as eligible approvers

#### Scenario: Active delegate is included and attributed

- **GIVEN** an eligible approver has an active delegation covering this document
- **WHEN** a participant requests the pending-step approvers
- **THEN** the delegate appears as an eligible actor with the principal recorded as who they act
  for, and no second-hop delegate is included

#### Scenario: Non-participant cannot see approver identities

- **GIVEN** a `DOC_VIEW` user who is neither the creator nor an eligible approver of any step
- **WHEN** that user requests the pending-step approvers
- **THEN** the request is rejected as not found

#### Scenario: Document not in approval yields no pending approvers

- **GIVEN** a document in `DRAFT` (or a terminal status)
- **WHEN** a participant requests the pending-step approvers
- **THEN** an empty/absent pending result is returned, not an error

