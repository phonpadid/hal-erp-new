## ADDED Requirements

### Requirement: Delegation Listing

The web app SHALL show a `WORKFLOW_MANAGE` user the active company's approval delegations
(delegator, delegate, optional document type, amount limit, validity window, status).

#### Scenario: Lists the company's delegations

- **WHEN** a `WORKFLOW_MANAGE` user opens the delegations area
- **THEN** the active company's delegations are listed with their status

### Requirement: Create a Delegation

The web app SHALL let a `WORKFLOW_MANAGE` user create a delegation (delegator → delegate, optional
document type and amount limit, start and end dates, optional reason), validated client-side
against the shared schema. The engine applies it one-hop only at act time.

#### Scenario: Create a delegation

- **WHEN** the user submits a valid delegation
- **THEN** it appears in the list as active

#### Scenario: Required field blocks save

- **WHEN** the user submits without a delegate or dates
- **THEN** a validation error is shown and nothing is sent

### Requirement: Cancel a Delegation

The web app SHALL let a `WORKFLOW_MANAGE` user cancel an active delegation, after which it no
longer applies to routing.

#### Scenario: Cancel an active delegation

- **WHEN** the user cancels an active delegation
- **THEN** it shows as cancelled and is no longer applied by the engine

### Requirement: Permission-Gated Delegation Admin

The delegation navigation, list, and actions SHALL be shown only to users holding
`WORKFLOW_MANAGE` (UX only; the server still enforces).

#### Scenario: Delegation admin hidden without permission

- **WHEN** a user without `WORKFLOW_MANAGE` is signed in
- **THEN** the Delegations navigation entry is not shown
