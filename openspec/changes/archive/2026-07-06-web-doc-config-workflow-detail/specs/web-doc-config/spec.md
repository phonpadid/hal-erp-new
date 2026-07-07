## MODIFIED Requirements

### Requirement: Workflow and Step Management

The web app SHALL let a `WORKFLOW_MANAGE` user list and create workflows and add steps, so a
mapping can route documents. The step editor SHALL let the user choose the approver as either a
company role (`approverRoleId`) or a specific person (`approverUserId`), set the step's amount
range (`amountMin`/`amountMax`), the approval mode (SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY),
and the SLA hours. The workflow editor SHALL let the user express the workflow's selection
condition by amount band and position level (`job_level`), mirrored by the shared Zod schema so
client and server validation agree.

The web app SHALL additionally provide a per-workflow **detail view** on its own
directly-linkable route (`/doc-config/workflows/:workflowId`), reachable from the Workflows
list. The detail view SHALL show the workflow header (name and active state) and its selection
condition (amount band and position/job levels) as a readable summary, and SHALL list the
workflow's steps in full — step number, name, resolved approver (the role name or the person's
display label), amount range, approval mode, SLA hours, and any per-step condition — rather than
as collapsed chips. The detail view SHALL let a `WORKFLOW_MANAGE` user add a step from that
page. The route SHALL be gated by permission code as a UX-only guard, with the server remaining
authoritative for company scope and permission enforcement. An unknown `:workflowId` SHALL show
a not-found state rather than an error.

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
