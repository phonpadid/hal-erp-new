## MODIFIED Requirements

### Requirement: Workflow and Step Management

The web app SHALL let a `WORKFLOW_MANAGE` user list and create workflows and add steps, so a
mapping can route documents. The step editor SHALL let the user choose the approver as either a
company role (`approverRoleId`) or a specific person (`approverUserId`), set the step's amount
range (`amountMin`/`amountMax`), the approval mode (SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY),
and the SLA hours. The workflow editor SHALL let the user express the workflow's selection
condition by amount band and position level (`job_level`), mirrored by the shared Zod schema so
client and server validation agree.

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
