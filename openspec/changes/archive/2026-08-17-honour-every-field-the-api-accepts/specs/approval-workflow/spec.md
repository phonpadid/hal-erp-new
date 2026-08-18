# approval-workflow

## MODIFIED Requirements

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

Creating, updating or deleting a step SHALL be rejected while the step's workflow has any document
in a non-terminal state (`SUBMITTED` or `IN_APPROVAL`), because routing reads the live step set;
otherwise the operation SHALL be applied. Adding a step to a routing workflow SHALL be refused for
the same reason editing one is: a step inserted below the document's current step is skipped
without record, and one inserted above it imposes an approval the document did not carry when it
was submitted.

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

#### Scenario: Adding a step is rejected while a document is in-flight

- **WHEN** the user adds a step to a workflow that has a document in `SUBMITTED` or `IN_APPROVAL`
- **THEN** the addition is rejected and the workflow's step set is unchanged

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

- **WHEN** a user attempts to create into, update or delete a workflow or step belonging to
  another company
- **THEN** the operation is not applied

### Requirement: Authorized, Append-Only Actions with Hold Release

Every approval action SHALL require `DOC_APPROVE`, be recorded in the append-only
`approval_log` (never modified), and carry actor, action, timestamp, and remark.

The action endpoint SHALL accept only the actions a person performs: `APPROVE`, `REJECT` and
`RETURN`. `ESCALATE` SHALL be written by the system's SLA sweep alone and SHALL be refused when it
arrives from a caller, because a row in the audit trail that reads as an automated escalation MUST
NOT be authorable by the approver it excuses. Refusal SHALL happen at validation, before any
`approval_log` row is written. The set of actions the routing engine handles SHALL be exhaustive
over the accepted set, so an action the engine does not act on cannot become a history row.

On an APPROVE action the system SHALL additionally stamp `approval_log.signature_id` with the
acting user's `app_user.current_signature_id` as it stands at the moment of approval, so
the recorded signature is locked to the approval event and is unaffected by any later
signature change; when the acting user has no current signature the action SHALL still
succeed and `signature_id` SHALL be null. REJECT and RETURN actions SHALL NOT
stamp a signature. REJECT SHALL set the document `REJECTED` and release its reserved
budget and quota; RETURN SHALL set it `DRAFT` and release holds so the requester can revise
and resubmit.

#### Scenario: Reject releases holds

- **GIVEN** a document holding budget/quota reservations
- **WHEN** an approver rejects it
- **THEN** it becomes `REJECTED` and all reservations are released

#### Scenario: The audit trail is immutable

- **WHEN** an attempt is made to update an existing `approval_log` row
- **THEN** it is rejected (append-only)

#### Scenario: An approver cannot post an escalation

- **GIVEN** an eligible approver on a document's current step
- **WHEN** they submit the action `ESCALATE`
- **THEN** the request is refused at validation, no `approval_log` row is written, and the
  document's current step is unchanged

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

- **WHEN** an approver rejects or returns
- **THEN** the recorded `approval_log` row has a null `signature_id`

### Requirement: Append-Only Audit Trail

Every approve, reject and return action SHALL be recorded in `approval_log` and MUST NOT be
modified afterward, alongside the `ESCALATE` rows the SLA sweep writes.

#### Scenario: Each action is auditable

- **GIVEN** a document that passed three approval steps
- **WHEN** its history is viewed
- **THEN** every actor, action, timestamp, and remark is present and immutable

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
