# approval-workflow

## MODIFIED Requirements

### Requirement: SLA and Escalation

The system SHALL track a working-hour SLA per step computed from the recorded step's `sla_hours`
against the company `holiday_calendar` (skipping weekends and company holidays), measured from that
step's `started_at`, and SHALL run a scheduled sweep over overdue `IN_APPROVAL` steps that have no
active delegation.

Escalation SHALL change WHO may act on the overdue step. It SHALL NOT advance the document past it.
The number of approvals a document requires is fixed by its route at submit and SHALL NOT be reduced
by the passage of time: a requester who would rather not be seen by a given approver must not be
able to remove that approver by waiting.

When the overdue step names an escalation target, the system SHALL record that target on the step,
leave `current_step_no` where it is, notify the target, and append an `ESCALATE` entry to the
append-only `approval_log` naming both the overdue principal and the target. The target SHALL then
be an eligible actor on that step alongside its principals and their delegates. Escalation MUST NOT
make the document's creator an eligible actor (no-self-approval holds after escalation) and MUST NOT
modify any existing `approval_log` row.

When the overdue step names NO escalation target, the system SHALL escalate nothing: it SHALL notify
the overdue approver again and leave the step as it is. A route that stalls is visible on the
approval-ageing report and in the inbox; a route that silently shortens itself is not.

A `PARALLEL_ALL` step SHALL NOT be reassigned by escalation whatever it names, because one actor
cannot stand in for the several the mode requires, and no rule says which of them a single approval
would discharge. Such a step SHALL be notified again like a step with no target.

A step SHALL be escalated at most once: a sweep that finds a step already escalated SHALL notify
without appending a second `ESCALATE` row.

#### Scenario: An overdue step gains its escalation target, and keeps its approval

- **GIVEN** a step whose working-hour SLA has elapsed since it opened, naming an escalation target,
  and no active delegation exists
- **WHEN** the escalation sweep runs
- **THEN** the document stays on that step, the target is recorded on it and notified, an
  `ESCALATE` row naming both ends is appended, and the step's approval has still not happened

#### Scenario: The escalation target may then act

- **GIVEN** a step that has been escalated to a target
- **WHEN** that target approves
- **THEN** the approval is accepted and routing advances as it would for the step's own approver

#### Scenario: A step with no target is chased, not skipped

- **GIVEN** an overdue step naming no escalation target
- **WHEN** the escalation sweep runs
- **THEN** the document stays on that step, its approver is notified again, and no `ESCALATE` row
  is written

#### Scenario: A committee is never discharged by one person

- **GIVEN** an overdue `PARALLEL_ALL` step naming an escalation target
- **WHEN** the escalation sweep runs
- **THEN** the step is notified again and no actor is added to it

#### Scenario: Escalating twice writes one row

- **GIVEN** a step already escalated to its target and still overdue
- **WHEN** the sweep runs again
- **THEN** the approvers are notified again and `approval_log` still holds exactly one `ESCALATE`
  row for that step

#### Scenario: A step that just opened is not overdue

- **GIVEN** a route whose earlier step consumed more than the whole SLA
- **WHEN** the next step opens and the sweep runs
- **THEN** it is not escalated, because its own clock has just started

#### Scenario: Working-day computation skips holidays

- **GIVEN** a step opened before a weekend and a company holiday
- **WHEN** the SLA due time is computed from `sla_hours`
- **THEN** weekends and the company's `holiday_calendar` dates are excluded from the elapsed
  working hours

#### Scenario: Escalation never makes the creator an approver

- **GIVEN** an overdue step whose escalation target resolves to the document's creator
- **WHEN** the escalation sweep runs
- **THEN** the creator does not become an eligible actor and the step is chased instead

#### Scenario: Active delegation suppresses escalation

- **GIVEN** an overdue step whose approver has an active delegation covering the document
- **WHEN** the escalation sweep runs
- **THEN** the item is left for the delegate and is not escalated

### Requirement: Delegation and Self-Approval Enforcement

A step approver SHALL be resolved from `approver_user_id` or the holders of
`approver_role_id` in the document's company, plus the escalation target recorded on the step if it
has been escalated.

A delegation's `start_date`/`end_date` window SHALL be compared against the **document company's**
calendar day, resolved from `company.timezone` — never against the server's UTC day. A date decides
which side of a boundary a fact falls on, which `gl-journal` already settled for `entry_date`; a
delegation written "to the 31st" for a company in UTC+7 must not stop working at 07:00 on the 31st
local. An active `approval_delegation` (date range,
document-type scope, amount limit) SHALL reroute the item to the delegate, recording
`delegated_from`. The system MUST block an approval when the acting user — or the
delegator they act for — is the document's creator (no self-approval, directly or via
delegation), and MUST NOT follow a delegate's own delegation (no chaining).

#### Scenario: A delegation window is the company's own days

- **GIVEN** a company in UTC+7 and a delegation whose `end_date` is the 31st
- **WHEN** an item is routed at 08:00 local on the 31st, which is the 30th in UTC
- **THEN** the delegate is still eligible

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

Creating or updating a step SHALL resolve `workflow_step.approver_role_id` and
`workflow_step.escalate_to_role_id` against the active company's `role` rows, and
`workflow_step.approver_user_id` and `workflow_step.escalate_to_user_id` against the users holding a
role in the active company (`user_company_role`), and SHALL refuse a target belonging to another
company with an error naming the offending field. A step SHALL NOT be configured with a principal that
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

#### Scenario: A step cannot name an escalation target from another company

- **GIVEN** a `WORKFLOW_MANAGE` user whose active company is A
- **WHEN** they create or update a step naming an `escalate_to_role_id` or `escalate_to_user_id`
  belonging to company B
- **THEN** the request is refused with an error naming that field and the step is unchanged

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
`sla_hours`, the approver target (`approver_role_id` or `approver_user_id`), the escalation target
(`escalate_to_role_id` or `escalate_to_user_id`), `show_signature_on_pdf`, and a nullable
`source_workflow_step_id` identifying the configuration it came from. Once written, a row's copied values SHALL NOT be changed by any later edit to
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
