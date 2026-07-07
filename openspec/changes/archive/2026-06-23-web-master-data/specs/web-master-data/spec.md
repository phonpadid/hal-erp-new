## ADDED Requirements

### Requirement: Vendor and Item Registry

The web app SHALL show a `MASTER_VIEW` user the vendor and item registries, each row indicating
whether the record is enabled for the active company. The registries SHALL be reachable from a
single "Master data" area.

#### Scenario: Lists vendors and items with enabled state

- **WHEN** a `MASTER_VIEW` user opens master data
- **THEN** vendors and items are listed, each showing whether it is enabled for the active company

### Requirement: Create and Edit Master Records

The web app SHALL let a `MASTER_MANAGE` user create and edit vendors and items through a form
validated client-side against a schema that mirrors the backend DTO (shared as the single source
of truth). Invalid input SHALL be blocked before submit.

#### Scenario: Required field blocks save

- **WHEN** the user submits a vendor or item form with a required field empty
- **THEN** a validation error is shown and nothing is sent to the server

#### Scenario: Valid record is created

- **WHEN** the user submits a valid new vendor or item
- **THEN** it is created and appears in the registry

### Requirement: Enable or Disable for the Active Company

The web app SHALL let a `MASTER_MANAGE` user enable or disable a vendor or item for the active
company, and reflect the new state. Enabling makes the record usable on that company's documents;
disabling removes it from the enabled set.

#### Scenario: Enabling makes a record usable

- **WHEN** the user enables a vendor for the active company
- **THEN** the vendor appears as enabled and is available to that company's document lines

#### Scenario: Disabling removes it from the enabled set

- **WHEN** the user disables an item for the active company
- **THEN** the item no longer shows as enabled for that company

### Requirement: Permission-Gated Master-Data Affordances

Browsing SHALL require `MASTER_VIEW`; create, edit, and enable/disable affordances SHALL be shown
only with `MASTER_MANAGE` (UX only; the server still enforces).

#### Scenario: Manage actions hidden without permission

- **WHEN** a user with `MASTER_VIEW` but not `MASTER_MANAGE` opens master data
- **THEN** the create / edit / enable / disable controls are not shown
