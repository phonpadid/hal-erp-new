## MODIFIED Requirements

### Requirement: Workflow and Step Management

The web app SHALL let a `WORKFLOW_MANAGE` user list and create workflows and add steps, so a
mapping can route documents. The step editor SHALL let the user choose the approver as either a
company role (`approverRoleId`) or a specific person (`approverUserId`), set the step's amount
range (`amountMin`/`amountMax`), the approval mode (SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY),
and the SLA hours. The step editor SHALL let the user set the step's "Engage for levels"
condition in one of two mutually exclusive modes: an **explicit list** of job levels or a
**minimum rank** threshold. The job-level options offered SHALL be sourced from the active
company's active `job_level` master rows (never a hardcoded level set), so the condition and the
requester's level always reference the same value set; the editor SHALL prevent authoring both an
explicit list and a rank threshold on the same step. The workflow editor SHALL let the user
express the workflow's selection condition by amount band and position level, mirrored by the
shared Zod schema so client and server validation agree.

The web app SHALL additionally provide a per-workflow **detail view** on its own
directly-linkable route (`/doc-config/workflows/:workflowId`), reachable from the Workflows
list. The detail view SHALL show the workflow header (name and active state) and its selection
condition (amount band and position/job levels) as a readable summary, and SHALL list the
workflow's steps in full — step number, name, resolved approver (the role name or the person's
display label), amount range, approval mode, SLA hours, and any per-step condition (the explicit
level list or the minimum-rank threshold) — rather than as collapsed chips. The detail view SHALL
let a `WORKFLOW_MANAGE` user add a step from that page. The route SHALL be gated by permission
code as a UX-only guard, with the server remaining authoritative for company scope and permission
enforcement. An unknown `:workflowId` SHALL show a not-found state rather than an error.

The web app SHALL additionally let a `WORKFLOW_MANAGE` user **edit and remove** workflows and
steps. The user SHALL be able to rename a workflow, edit its selection condition, and toggle its
active state; delete a workflow; edit an existing step (reusing the step form and its
client-side validation); and delete a step. Destructive actions (delete workflow, delete step)
SHALL require an explicit confirmation in the UI. These affordances SHALL be gated by permission
code as a UX-only guard; the server remains authoritative and MAY reject an edit or delete
(e.g. a workflow still referenced by a mapping or a document, or a step whose workflow has an
in-flight document), in which case the UI SHALL surface the server's reason rather than fail
silently.

#### Scenario: Create a workflow with a step

- **WHEN** the user creates a workflow and adds an approver step
- **THEN** the workflow lists that step

#### Scenario: Assign a specific person as approver

- **WHEN** the user adds a step and selects a specific person instead of a role
- **THEN** the step is saved with `approverUserId` and the person is shown as the approver

#### Scenario: Set a step amount range

- **WHEN** the user sets `amountMin` and/or `amountMax` on a step
- **THEN** the values are validated client-side and saved, and an inverted range
  (`amountMin` greater than `amountMax`) is rejected before sending

#### Scenario: Engage-for-levels options come from the job-level master

- **WHEN** the user opens the "Engage for levels" control on the step editor
- **THEN** the selectable levels are the active company's active `job_level` rows, not a
  hardcoded list

#### Scenario: Set a step's explicit level list

- **WHEN** the user selects one or more job levels for a step in explicit-list mode
- **THEN** the step's condition is saved as `jobLevels` and shown on the step summary

#### Scenario: Set a step's minimum-rank condition

- **WHEN** the user chooses the minimum-rank mode and picks a threshold level
- **THEN** the step's condition is saved as `minRank` and the step summary describes it as
  "that level and above"

#### Scenario: Explicit list and rank threshold are mutually exclusive

- **WHEN** the user sets one condition mode on a step
- **THEN** the other mode's input is cleared/disabled so a step cannot carry both

#### Scenario: Set a workflow level condition

- **WHEN** the user sets a position-level selection condition on a workflow
- **THEN** it is saved to the workflow's selection condition and shown in the workflow summary

#### Scenario: Open a workflow's detail view

- **WHEN** the user selects a workflow from the Workflows list
- **THEN** they are taken to that workflow's detail route showing its name, active state,
  selection condition, and every step's full configuration (approver, amount range, mode,
  SLA, and condition)

#### Scenario: Workflow detail is directly linkable

- **WHEN** the user navigates directly to a workflow's detail route (e.g. after a refresh or
  from a shared link)
- **THEN** the workflow's detail is shown, loading the workflow data if it is not already in
  memory

#### Scenario: Add a step from the detail view

- **WHEN** a `WORKFLOW_MANAGE` user adds a step from a workflow's detail view
- **THEN** the step is saved and appears in that workflow's step list on the detail view

#### Scenario: Unknown workflow id

- **WHEN** the user navigates to a detail route whose `:workflowId` matches no workflow in the
  active company
- **THEN** a not-found state is shown with a way back to the Workflows list, not an error

#### Scenario: Rename a workflow and toggle its active state

- **WHEN** a `WORKFLOW_MANAGE` user renames a workflow or toggles its active state
- **THEN** the change is saved and reflected in the list and detail view

#### Scenario: Edit an existing step

- **WHEN** the user edits a step's approver, amount range, mode, SLA, or condition and saves
- **THEN** the updated values are validated client-side and shown on the workflow's step list

#### Scenario: Delete a step with confirmation

- **WHEN** the user deletes a step and confirms the action
- **THEN** the step is removed from the workflow's step list

#### Scenario: Delete a workflow with confirmation

- **WHEN** the user deletes a workflow and confirms the action
- **THEN** the workflow is removed from the list, or, if the server rejects the deletion, the
  reason is surfaced and the workflow remains

#### Scenario: Server rejection is surfaced

- **WHEN** the user attempts a delete or edit that the server rejects (e.g. a referenced
  workflow or an in-flight step change)
- **THEN** the UI shows the server's reason and leaves the workflow or step unchanged
