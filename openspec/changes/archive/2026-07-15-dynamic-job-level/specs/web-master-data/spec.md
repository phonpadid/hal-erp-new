## ADDED Requirements

### Requirement: Job-Level Management Surface

The web app SHALL provide a job-level management surface within the "Master data" area where a
`JOB_LEVEL_VIEW` user can list the active company's `job_level` rows (showing `code`, `name`,
`rank`, and active state) and a `JOB_LEVEL_MANAGE` user can create, edit, and deactivate them.
Create and edit SHALL use a form validated client-side against a shared Zod schema that mirrors
the backend DTO (the single source of truth), rejecting a duplicate `code` within the company and
a missing `code`/`name`/`rank` before submit. Deactivation SHALL set the row inactive rather than
delete it. The surface SHALL be scoped to the active company; switching the active company SHALL
reload the list. The affordances SHALL be gated by permission code as a UX-only guard, with the
server remaining authoritative for company scope and permission enforcement.

#### Scenario: List job levels for the active company

- **WHEN** a `JOB_LEVEL_VIEW` user opens the job-level surface
- **THEN** the active company's `job_level` rows are listed with `code`, `name`, `rank`, and
  active state

#### Scenario: Create a job level

- **WHEN** a `JOB_LEVEL_MANAGE` user submits a valid new job level (unique `code`, a `name`, and
  a `rank`)
- **THEN** it is created and appears in the list

#### Scenario: Duplicate code is blocked before submit

- **WHEN** the user enters a `code` that already exists in the active company
- **THEN** a validation error is shown and nothing is sent to the server

#### Scenario: Deactivate a job level

- **WHEN** a `JOB_LEVEL_MANAGE` user deactivates a job level
- **THEN** it is marked inactive in the list and no longer offered as an assignable option in the
  employee and workflow-step editors

#### Scenario: Job-level management is permission-gated

- **WHEN** a user without `JOB_LEVEL_MANAGE` attempts to create, edit, or deactivate a job level
- **THEN** the affordances are unavailable and the server rejects any such request

#### Scenario: Job levels are scoped to the active company

- **WHEN** the user switches the active company
- **THEN** the job-level list reloads to show only that company's levels
