## ADDED Requirements

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
