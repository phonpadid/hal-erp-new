# Approval Workflow Specification

## Purpose
Configurable, multi-step approval routing with conditions, parallel modes,
delegation during absence, SLA escalation, and a complete audit trail.
## Requirements
### Requirement: Conditional Workflow Selection

The system SHALL bind a document to the workflow mapped to its company, department, and
document type, and SHALL include a step in routing only when the step's conditions match the
document. Step inclusion SHALL honour the step's `amount_min`/`amount_max` band against the
document's `base_total_amount`, AND a step's `workflow_step.condition_json` job-level condition
against the requester's `employee.job_level` and its `rank`.

Selection SHALL be by the `dept_doc_type` mapping alone. The system SHALL NOT carry a
workflow-level selection condition: a rule that selects nothing while appearing to select
something is indistinguishable, to the administrator who wrote it, from one that works. Every
condition the routing engine evaluates SHALL live on `workflow_step`.

A step's `workflow_step.condition_json` job-level condition SHALL take one of two mutually
exclusive forms:
- an explicit list `{ "jobLevels": ["MANAGER", ...] }` — the step engages when the requester's
  `employee.job_level` code is in the list; or
- a rank threshold `{ "minRank": N }` — the step engages when the `rank` of the requester's
  `employee.job_level` (resolved from the company's `job_level` master row) is greater than or
  equal to `N`.

Referenced `jobLevels` codes SHALL be codes of `job_level` rows in the document's company;
matching against `employee.job_level` SHALL be by exact code (both sides are drawn from the same
company `job_level` master, so no case-folding is applied). If a condition carries both keys,
`jobLevels` SHALL take precedence and `minRank` SHALL be ignored. A step with no job-level
condition SHALL apply to every requester.

A workflow is *level-gated* when at least one of its steps carries a non-empty `jobLevels` list
or a `minRank` threshold in `workflow_step.condition_json`. When a document is submitted into a
level-gated workflow and the requester has no `employee.job_level` (the requester has no linked
`employee`, or the linked `employee.job_level` is null or empty), the system SHALL reject the
submit with a clear error naming the missing job level, leave the document `DRAFT`, create no
budget or quota holds, and start no routing. The requester's missing `job_level` SHALL NOT
silently skip level-gated steps. When the bound workflow is not level-gated, a requester without
a `job_level` SHALL submit normally.

#### Scenario: Amount picks the longer chain

- **GIVEN** a chain whose final step has `amount_min` 500,000
- **WHEN** a document with base amount 600,000 is submitted
- **THEN** that step is included in the routing and a 400,000 document skips it

#### Scenario: The workflow is chosen by its mapping alone

- **GIVEN** a department and document type mapped to one workflow
- **WHEN** a document of that type is created in that department
- **THEN** it is bound to the mapped workflow, and no workflow-level condition participates in
  the choice

#### Scenario: Position level gates a step by explicit list

- **GIVEN** a step whose `condition_json` restricts `jobLevels` to "MANAGER"
- **WHEN** a document is submitted by a requester whose `employee.job_level` is "STAFF"
- **THEN** that step is skipped, and a document from a "MANAGER" requester includes it

#### Scenario: Rank threshold gates a step

- **GIVEN** a step whose `condition_json` is `{ "minRank": 30 }`
- **AND** the company's `job_level` rows give "STAFF" rank 10 and "DIRECTOR" rank 40
- **WHEN** a document is submitted by a "STAFF" requester
- **THEN** the step is skipped, and a document from a "DIRECTOR" requester (rank 40 ≥ 30) includes it

#### Scenario: Explicit list wins when both keys are present

- **GIVEN** a step whose `condition_json` carries both `{ "jobLevels": ["MANAGER"] }` and `"minRank": 1`
- **WHEN** documents are submitted by requesters of various levels
- **THEN** only requesters whose level is exactly "MANAGER" engage the step; `minRank` is ignored

#### Scenario: Unrestricted step applies to everyone

- **WHEN** a step has no job-level condition in its `condition_json`
- **THEN** it is included regardless of the requester's `job_level`

#### Scenario: Missing job level blocks submit into a level-gated workflow

- **GIVEN** a bound workflow with at least one step restricting `jobLevels` or carrying `minRank`
- **AND** a requester whose `employee.job_level` is null or empty (or who has no linked `employee`)
- **WHEN** the document is submitted
- **THEN** the submit is rejected with an error naming the missing job level, the document remains
  `DRAFT`, and no budget/quota holds or routing are created

#### Scenario: Missing job level does not block a non-level-gated workflow

- **GIVEN** a bound workflow whose steps carry no `jobLevels` or `minRank` condition
- **AND** a requester whose `employee.job_level` is null or empty
- **WHEN** the document is submitted
- **THEN** the submit proceeds normally and routing starts over the applicable steps

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

### Requirement: Approver by Role or Person

A step SHALL target either a company role (`approver_role_id`) or a specific user
(`approver_user_id`), and the system SHALL refuse to save a step of an active workflow that targets
neither.

The requirement was already stated and was never enforced. A step naming nobody resolves to an empty
principal list, and nothing downstream objects: the step still matches on its amount band and the
requester's level, routing opens it, zero actors are written, and the document becomes
`IN_APPROVAL`. It then sits in no one's queue, holding whatever it reserved at submit, with no error
raised and no notification sent — indistinguishable from a document that is merely waiting.

Refusal SHALL turn on what the configuration names, never on who currently holds it. A step naming a
role with no holders today SHALL be accepted: that is a staffing fact, true only today, and answered
by adding somebody to the role rather than by editing the workflow. A step naming nothing at all
cannot be answered that way, because there is nothing for a later act to fill.

#### Scenario: Role-based step resolves current holder

- GIVEN a step targeting the "Department Head" role
- WHEN routing reaches that step
- THEN the current holder of that role in the document's department is assigned

#### Scenario: A step naming nobody is refused

- **WHEN** a `WORKFLOW_MANAGE` user saves a step of an active workflow with neither an approver role
  nor an approver user
- **THEN** the save is rejected, naming the step

#### Scenario: A role with no holders is still a valid target

- **GIVEN** a company role that nobody currently holds
- **WHEN** a step is saved targeting that role
- **THEN** the save succeeds, because who holds the role is not a property of the workflow

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

### Requirement: Reject Returns and Releases

On rejection the system SHALL set the document to REJECTED, release reserved budget
and quota, and allow the requester to revise and resubmit.

A resubmission SHALL resolve and record a fresh route from the configuration in force at that
moment, and SHALL mark the previous route's rows superseded rather than deleting them, so each
attempt keeps the record of the chain it actually ran.

Marking the previous rows superseded SHALL be durable in the database **before** the replacement
rows are written, within the same transaction. `document_approval_step` carries a partial unique
key on `(document_id, step_no)` where `superseded_at IS NULL`; a replacement row inserted while its
predecessor is still live violates that key, the whole routing transaction rolls back, and the
document is left `SUBMITTED` holding a reservation with no route and no approver. The ordering SHALL
be stated by the code rather than inherited from whatever order the ORM happens to flush a unit of
work in, because "supersede, then replace" is the rule the unique key expresses and an ORM's flush
order is not part of that contract.

A resubmission whose route cannot be written SHALL leave the document `SUBMITTED` and SHALL be
reported at error level, naming the document and the holds it is carrying. It SHALL NOT be
discarded at a log level the application does not enable: a document holding budget in nobody's
queue is invisible to every user of the product, so the server log is the only place its existence
can be known.

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

#### Scenario: A returned document can be resubmitted

- **GIVEN** a document an approver returned, now `DRAFT`, whose first attempt left
  `document_approval_step` rows behind
- **WHEN** the requester resubmits it
- **THEN** it reaches `IN_APPROVAL` at the first applicable step, its previous route's rows are
  marked superseded, and one live row exists per applicable step

#### Scenario: A resubmission is routed by current configuration

- **GIVEN** a returned document whose workflow gained a step while it was in `DRAFT`
- **WHEN** it is resubmitted
- **THEN** its new route includes that step, and the superseded route still shows the chain the
  first attempt ran

#### Scenario: A route that cannot be written is reported, not swallowed

- **GIVEN** a submitted document whose route write fails
- **WHEN** the auto-start listener handles the failure
- **THEN** the failure is logged at error level naming the document, rather than at a level the
  application does not enable

#### Scenario: Rejecting a budget plan marks its proposed budgets REJECTED

- **GIVEN** a submitted budget plan carrying `DRAFT` budgets
- **WHEN** an approver rejects it
- **THEN** every budget the plan references has `status` `REJECTED` in the same transaction that
  marks the document `REJECTED`
- **AND** no budget release row is written

### Requirement: Append-Only Audit Trail

Every approve, reject, return and withdrawal action SHALL be recorded in `approval_log` and MUST NOT
be modified afterward, alongside the `ESCALATE` rows the SLA sweep writes.

A document's history SHALL therefore have no terminal outcome that leaves no row: approval,
rejection, return and withdrawal each name their actor, and a reader never has to infer who ended a
document from `document.created_by` or when from a mutable timestamp.

#### Scenario: Each action is auditable

- **GIVEN** a document that passed three approval steps
- **WHEN** its history is viewed
- **THEN** every actor, action, timestamp, and remark is present and immutable

#### Scenario: A withdrawn document's history names who ended it

- **GIVEN** a document withdrawn by its creator while in approval
- **WHEN** its history is viewed
- **THEN** the withdrawal appears as a `CANCEL` row with its actor, step, time and remark, rather
  than as a history that stops mid-route

### Requirement: Post-Action Engine
On full approval the system SHALL execute the type's `post_action` and MUST retry on
failure rather than leaving the document stuck.

#### Scenario: Failed post-action retries
- GIVEN an approved promotion whose payroll update fails transiently
- WHEN the post-action runs
- THEN it is retried and the document is not left in an inconsistent state

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
signature change; when the acting user has no current signature the action SHALL still
succeed and `signature_id` SHALL be null. REJECT, RETURN and CANCEL actions SHALL NOT
stamp a signature. REJECT SHALL set the document `REJECTED` and release its reserved
budget and quota; RETURN SHALL set it `DRAFT` and release holds so the requester can revise
and resubmit.

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

#### Scenario: Approve without a signature still records the action

- **GIVEN** an approver with no current signature
- **WHEN** they approve the current step
- **THEN** the approval succeeds and the `approval_log` row's `signature_id` is null

#### Scenario: Non-approve actions do not stamp a signature

- **WHEN** an approver rejects or returns, or a requester withdraws
- **THEN** the recorded `approval_log` row has a null `signature_id`

### Requirement: Post-Action Execution on Full Approval

On full approval the system SHALL run the document type's `post_action` atomically with
the terminal transition and a bounded retry, then mark the document `COMPLETED`. A
`CUT_BUDGET` action SHALL convert reservations to actuals (`settle`) AND signal payment-ready
(emit a `payment.ready` event for the settled document); `TRANSFER` /
`ADJUST_INCREASE` / `ADJUST_DECREASE` SHALL execute the document's `budget_movement`; an
`ACTIVATE_BUDGET` action SHALL activate every budget the document's `budget_movement` rows
reference; a `CREATE_SUCCESSOR` action SHALL **record a `PENDING` obligation for** each successor
pairing of the approved document's type marked `auto_create=true` in `document_type_ref`, **which a
sweep outside this transaction later fulfils by `createFrom`**,
and SHALL be a logged no-op when no such pairing exists. If the post-action ultimately
fails the terminal transition SHALL roll back, leaving the document not stuck (still routable),
never half-applied.

`ACTIVATE_BUDGET` is the first action that reads **many** `budget_movement` rows for one document
rather than exactly one. `TRANSFER` and the two `ADJUST` actions each execute the single movement
their document carries and SHALL continue to do so; `ACTIVATE_BUDGET` SHALL read all of them, and
SHALL activate them as one unit so a fiscal year is never left partly in force. It writes no
`budget_txn` row, because a budget's opening figure is `budget.amount_total` rather than a
transaction (invariant 3).

**`CREATE_SUCCESSOR` SHALL NOT create the successor document inside this transaction**, because
`createFrom` requires the source to be `APPROVED` or `COMPLETED` — a state it has not reached
while the transaction that grants it is still open — and because a downstream type's health MUST
NOT be able to veto an approval its approvers already granted. Recording the obligation is what
satisfies the never-half-applied rule: the document and everything it owes commit together, so a
`COMPLETED` document always carries a durable record of the successor it owes. A failure to record
the obligation SHALL roll the terminal transition back like any other post-action failure; a
failure to *fulfil* it later SHALL NOT, and SHALL instead become a visible `FAILED` obligation.

#### Scenario: Budget document settles on approval

- **GIVEN** an approved `CUT_BUDGET` document that reserved 100000 on a budget
- **WHEN** the post-action runs
- **THEN** the reservation is settled to an actual and a `payment.ready` event is emitted

#### Scenario: A budget plan activates every line it carries

- **GIVEN** an approved document whose type has `post_action` `ACTIVATE_BUDGET`, carrying three
  `budget_movement` rows
- **WHEN** the post-action runs
- **THEN** all three referenced budgets become `ACTIVE` in the same transaction that marks the
  document `COMPLETED`

#### Scenario: A plan that fails to activate leaves the approval undone

- **GIVEN** an approved budget plan whose activation cannot complete
- **WHEN** the bounded retry is exhausted
- **THEN** the terminal transition rolls back, no budget on the plan is `ACTIVE`, and the document
  is not left `COMPLETED`

#### Scenario: A successor obligation commits with the approval

- **GIVEN** an approved document whose type is `CREATE_SUCCESSOR` with an `auto_create` pairing
- **WHEN** the post-action runs
- **THEN** a `PENDING` obligation is recorded in the same transaction that marks the document `COMPLETED`

#### Scenario: A successor that cannot be created does not undo the approval

- **GIVEN** a `COMPLETED` document whose owed successor cannot be created
- **WHEN** the sweep fails to fulfil the obligation
- **THEN** the document stays `COMPLETED` and the obligation is recorded as failed rather than rolled back

#### Scenario: Failing to record the obligation rolls the approval back

- **GIVEN** an approval whose `CREATE_SUCCESSOR` post-action cannot write its obligation
- **WHEN** the bounded retry is exhausted
- **THEN** the terminal transition rolls back and the document is not left `COMPLETED`

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

When a document is submitted and its mapped workflow has applicable steps, the system SHALL begin
approval routing automatically (transition `SUBMITTED` → `IN_APPROVAL` at the first applicable step)
so it appears in the relevant approvers' inboxes without a manual start. Starting the route SHALL
remain triggered by the submit event.

Deciding whether a route EXISTS is a different question from starting it, and the submit path SHALL
ask it. That makes document submission depend on the approval module's step resolution, which the
event trigger previously avoided — deliberately, and at the cost of only discovering an unroutable
document after it had been submitted and its holds taken. The dependency SHALL be expressed rather
than worked around: the submit path SHALL use the same resolution routing uses, never a second copy
of it, because two answers to "does this step apply" are free to disagree.

Using the same resolver is not sufficient on its own: it SHALL be given the same INPUT. A step's
amount band is compared against the document's base amount, which submit computes and stamps onto
`document.budget_base_total_amount` inside its write transaction — after the gate has already run.
The gate SHALL therefore be given the base amount this submission computed, rather than reading a
column the submission has not written yet. Reading the column instead means a first submission is
judged as if the document were worth zero, so a workflow whose lowest step carries an `amount_min`
above zero refuses every document it receives however large; and a resubmission is judged on the
previous attempt's figure, which the document may no longer carry. A workflow's lowest band SHALL
NOT be required to start at zero.

**A document whose workflow has no applicable step SHALL be refused at submit**, before any budget,
stock or quota hold is taken, and SHALL remain `DRAFT`. Such a document can never be approved: no
step engages it, so no approver will ever see it. Allowing the submit to succeed and discovering the
problem afterwards leaves the document stranded in a state that looks like progress while holding
appropriations nobody can release, since a reservation is only given back by a settlement or a
rejection and neither can happen to a document no one can act on.

The check SHALL sit with the other completeness gates on the submit path, which run above the
transaction so that a refused submit reserves nothing. It SHALL resolve applicability the same way
routing does — the amount band and the requester's level together — rather than by any separate
rule, so a document the gate accepts is one routing can start.

Applicability SHALL NOT be required to be provable when the workflow is configured. A step engages
on its amount band **and** on the requester's job level, so coverage depends on who submits, which
the configuration cannot know; a rule proved over every amount and level would refuse workflows that
are correct for the people who use them.

#### Scenario: Submit routes into approval

- **WHEN** a document with a mapped, applicable workflow is submitted
- **THEN** it transitions to `IN_APPROVAL` at the first step and its approvers can see it

#### Scenario: A workflow whose lowest band starts above zero still accepts a document inside it

- **GIVEN** a workflow whose only step engages at or above 10,000,000
- **WHEN** a 20,000,000 document is submitted for the first time
- **THEN** the submit is accepted and the document reaches `IN_APPROVAL` at that step

#### Scenario: A document with nowhere to route is refused

- **GIVEN** a document whose mapped workflow has no step applicable to its amount and requester
- **WHEN** it is submitted
- **THEN** the submit is rejected and the document remains `DRAFT`

#### Scenario: A refused submit reserves nothing

- **GIVEN** such a document, of a type that reserves budget
- **WHEN** the submit is rejected for having no applicable step
- **THEN** no `budget_txn` row was written for it, and no stock or quota hold was taken

#### Scenario: A resubmission is judged on the amount it now carries

- **GIVEN** a returned document whose lines were edited so its base amount falls below the only
  step's band
- **WHEN** it is resubmitted
- **THEN** the submit is refused for having no applicable step, rather than accepted on the figure
  its previous attempt stamped

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

### Requirement: The Approval History Identifies Approvers Without Exposing Their Accounts

A caller entitled to read a document SHALL be able to read its approval history, receiving for each entry the step number, the action taken, the remark written, the time it was taken, the approver, and the approver who delegated the authority where one did. The approver and the delegator SHALL each be identified by id and username and by nothing else.

The response SHALL be assembled from an explicit shape rather than serialized from the stored entity, so that a field added to a user or to a log row cannot widen what a caller receives without someone deciding that it should. In particular the response SHALL carry no credential material, no contact detail, no account status, and neither the stamped signature nor the nested document.

This read is available to an external API key holding the permission that reads a document, so the shape above is a contract with callers outside the company, not only a convenience for the web client.

#### Scenario: An approval entry names its approver

- **GIVEN** a document approved at a step by a user
- **WHEN** its approval history is read
- **THEN** the entry carries the step number, the action, the remark, the time, and an approver identified by id and username

#### Scenario: No account material reaches the caller

- **WHEN** a document's approval history is read
- **THEN** no entry carries a password hash, an email address, an account status, or a verification timestamp

#### Scenario: The stamped signature stays internal

- **GIVEN** a document approved by a user with a signature on file
- **WHEN** its approval history is read
- **THEN** the response carries no signature reference

#### Scenario: A delegated approval names both parties

- **GIVEN** an entry recorded by a delegate acting for a principal
- **WHEN** the history is read
- **THEN** both the acting approver and the delegating approver are identified by id and username

#### Scenario: An approval taken in the approver's own right reports no delegator

- **GIVEN** an entry recorded by an approver acting for themselves
- **WHEN** the history is read
- **THEN** the delegating approver is reported as absent rather than omitted from the entry

### Requirement: A Document No Step Applies To Is Reported, Not Silently Left

When a submitted document is routed and no workflow step applies to it, the system SHALL report the condition at a severity that is visible by default, identifying the document, stating that the budget it reserved remains held, and stating what must be corrected.

Such a document is stranded: it remains SUBMITTED, no approver is ever notified of it, and nothing in the system will pick it up. It SHALL NOT be reported at a diagnostic severity, and SHALL NOT share an outcome with conditions that are harmless.

A document whose routing has already begun SHALL NOT be reported this way — it is moving, and nothing is wrong with it.

Reporting SHALL NOT propagate the failure: routing runs after the submit has committed, so raising here would not undo the submit and would only obscure the report.

#### Scenario: A stranded document is reported

- **GIVEN** a submitted document whose workflow has no applicable step
- **WHEN** routing is attempted
- **THEN** the condition is reported at error severity, naming the document

#### Scenario: The report says what is wrong and what to do

- **GIVEN** a submitted document whose workflow has no applicable step
- **WHEN** the condition is reported
- **THEN** the report states that reserved budget is being held and what must be corrected

#### Scenario: An already-routed document is not reported as stranded

- **GIVEN** a document whose routing has already begun
- **WHEN** routing is attempted again
- **THEN** nothing is reported at error severity

#### Scenario: The failure does not escape

- **GIVEN** a submitted document whose workflow has no applicable step
- **WHEN** routing is attempted
- **THEN** no error is raised to the caller

### Requirement: A POST_JOURNAL Type Posts Its Voucher On Full Approval

The system SHALL support a `POST_JOURNAL` post-action: on full approval of a document of a type
carrying it, the journal voucher the document holds SHALL be posted through the same balanced entry
constructor every other posting uses.

The entry SHALL be dated the voucher's own accounting date, authored by the document's creator, and
keyed so that a retried approval resolves to the entry already written.

A `POST_JOURNAL` document SHALL write no `budget_txn` and SHALL NOT be marked payment-ready. An
accountant correcting the ledger is neither spending a budget nor asking for money to be sent.

Posting SHALL be driven by the post-action alone, not by the document type's code. Which types post
journals is configuration (invariant 7).

#### Scenario: Full approval posts the voucher

- **GIVEN** a document of a `POST_JOURNAL` type whose voucher balances
- **WHEN** its last applicable step approves
- **THEN** one balanced entry exists, dated the voucher's date and authored by the document's creator

#### Scenario: A partial approval posts nothing

- **GIVEN** a `POST_JOURNAL` document with more than one applicable step
- **WHEN** only the first step approves
- **THEN** no entry exists

#### Scenario: It reserves nothing and asks for no payment

- **WHEN** a `POST_JOURNAL` document completes
- **THEN** no `budget_txn` row is written and no payment-ready event is raised

### Requirement: An Approval That Could Not Post Is Refused Before It Is Recorded

Where a document's post-action writes to the ledger, the system SHALL check that the entry's
accounting date falls in an open period BEFORE recording the approval, and SHALL refuse the approval
naming the period when it does not.

Without this the check happens inside the approval transaction, at the moment of posting. On a route
of one step that is merely inconvenient; on a longer route it is a defect: every approver but the
last has already approved, and the last one's action is rolled back with an error about a period they
did not choose and cannot open, leaving the document at a step whose approval can never commit.

The refusal SHALL leave no approval-log row, because no approval happened, and SHALL say that the
fix belongs to the document's author — withdraw and re-date — rather than to the approver.

This SHALL NOT replace the check inside the posting constructor, which remains the invariant. A
period can close between the check and the commit; what this removes is the ordinary case, not the
race.

#### Scenario: An approval into a closed period is refused

- **GIVEN** a document whose posting date falls in a period that closed while it waited
- **WHEN** an approver approves it
- **THEN** it is refused naming the period, no entry is written, and no approval-log row is added

#### Scenario: The refusal names who can fix it

- **WHEN** such an approval is refused
- **THEN** the message says the author must withdraw and re-date it

#### Scenario: An open period approves normally

- **GIVEN** the same document dated in an open period
- **WHEN** an approver approves it
- **THEN** the approval is recorded

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


### Requirement: A Step May Require Payment Evidence Before It Is Approved

A `workflow_step` SHALL carry `requires_payment_slip` (boolean, NOT NULL, default false). When a step's `requires_payment_slip` is true, an APPROVE on that step SHALL be refused unless the document already carries at least one `payment_attachment` row. The refusal SHALL name the reason, so the approver learns that evidence is missing rather than that the action failed.

The requirement SHALL be read from the step the document is currently on, not from the document's type, its amount, or its step number. Behaviour comes from configuration (invariant 7).

REJECT, RETURN and DELEGATE SHALL NOT be gated by this requirement. A step that cannot yet be approved MUST still be refusable and returnable, or a document with no evidence and no prospect of any could never leave approval.

The gate SHALL run inside the same transaction and under the same pessimistic write lock on the document as the rest of the approve path, after the eligibility and self-approval checks and BEFORE the `approval_log` row is written. A refused approval SHALL leave no `approval_log` row, SHALL NOT advance `document.current_step_no`, SHALL NOT close or open a step, and SHALL NOT release any budget or quota hold. `approval_log` is append-only (invariant 2), so an approval that must be refused SHALL be refused before it is recorded, never compensated afterwards.

Escalation SHALL NOT be gated by this requirement: the SLA sweeper reassigns a late step without an APPROVE, and lateness is not evidence.

#### Scenario: Approval is refused while no evidence is attached

- **GIVEN** a document in approval at a step whose `requires_payment_slip` is true, carrying no `payment_attachment`
- **WHEN** an eligible approver approves the step
- **THEN** the request is rejected naming the missing evidence
- **AND** no `approval_log` row is written and `document.current_step_no` is unchanged

#### Scenario: Approval succeeds once evidence is attached

- **GIVEN** the same document after a `PAYMENT_MANAGE` user has uploaded one slip against it
- **WHEN** the eligible approver approves the step
- **THEN** the approval is recorded and the route advances as it would for any step

#### Scenario: A step without the requirement is unaffected

- **GIVEN** a document at a step whose `requires_payment_slip` is false, carrying no slip
- **WHEN** an eligible approver approves the step
- **THEN** the approval is recorded

#### Scenario: Rejecting is always available

- **GIVEN** a document at a step requiring evidence, carrying no slip
- **WHEN** an eligible approver rejects the document
- **THEN** the rejection is recorded and the reserved budget and quota are released

#### Scenario: Returning is always available

- **GIVEN** a document at a step requiring evidence, carrying no slip
- **WHEN** an eligible approver returns the document
- **THEN** the document goes back to DRAFT and its holds are released

#### Scenario: Evidence attached to another document does not satisfy the step

- **GIVEN** a document at a step requiring evidence, carrying no slip, while a different document carries one
- **WHEN** an eligible approver approves the step
- **THEN** the request is rejected

#### Scenario: Two approvers racing the same gated step

- **GIVEN** a document at a step requiring evidence, carrying no slip
- **WHEN** two eligible approvers approve concurrently
- **THEN** both are refused and no `approval_log` row is written for either

### Requirement: The Payment-Evidence Requirement Is Configured On The Step

Creating or updating a `workflow_step` SHALL accept `requiresPaymentSlip` as a boolean and SHALL persist it to `workflow_step.requires_payment_slip`, under the same `WORKFLOW_MANAGE` permission, the same active-company scoping and the same single transaction as every other step field. Omitting the field on create SHALL store false. The step read surface SHALL return the flag, so a configuration screen can show what was authored.

Setting the flag SHALL be permitted while the workflow has documents in approval, like every other step mutation. Routing reads the route recorded on each document, so the change reaches documents submitted afterwards and cannot reach one already routing.

#### Scenario: The flag is authored on a step

- **GIVEN** a `WORKFLOW_MANAGE` user in the active company
- **WHEN** the user updates a step with `requiresPaymentSlip` true
- **THEN** `workflow_step.requires_payment_slip` is stored true for that step

#### Scenario: Omitting the field stores false

- **WHEN** a step is created without `requiresPaymentSlip`
- **THEN** the stored value is false

#### Scenario: The flag is returned when the step is read

- **GIVEN** a step whose `requires_payment_slip` is true
- **WHEN** a `WORKFLOW_MANAGE` user reads the workflow's steps
- **THEN** the step is returned carrying the flag

#### Scenario: Another company's workflow is refused

- **GIVEN** a step belonging to a workflow of another company
- **WHEN** a user sets `requiresPaymentSlip` on it
- **THEN** the request is refused as not-found, as for any other step mutation
