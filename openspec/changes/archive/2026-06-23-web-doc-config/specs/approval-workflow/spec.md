## ADDED Requirements

### Requirement: Workflow Read Surface

The system SHALL provide a read, under `WORKFLOW_MANAGE` and scoped to the active company, of the
company's workflows each with their steps (step number, approver role or user, amount range,
approval mode, SLA hours), so the configuration UI can show and extend routing.

#### Scenario: List workflows with steps

- **WHEN** a `WORKFLOW_MANAGE` user requests the workflows
- **THEN** the active company's workflows are returned, each with its ordered steps
