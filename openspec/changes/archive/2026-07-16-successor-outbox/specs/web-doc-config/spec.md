## ADDED Requirements

### Requirement: Successor Department on a Ref-Chain Pairing

The web app SHALL let a `DOC_CONFIG_MANAGE` user set an optional successor department per successor pairing in the ref-chain editor, offering only active departments of the active company and defaulting to none. The control SHALL make clear that leaving it empty creates the successor in the source document's own department, and that setting it hands the successor to that department — the case that models procurement's real split, where the requesting department asks and the buying department buys. The field SHALL be shown only for a pairing with **auto-create** on, because it has no effect on a manual create-from, whose department comes from the user doing the creating. The control SHALL show and hide by the `DOC_CONFIG_MANAGE` permission code from the active-company context; the client guard is UX only and the server still enforces company isolation and the permission.

#### Scenario: Set a successor department

- **WHEN** a `DOC_CONFIG_MANAGE` user sets the successor department of an auto-create `PROC → PO` pairing to Procurement
- **THEN** the pairing's `successor_department_id` is persisted and shown in the list

#### Scenario: Empty means the source document's department

- **WHEN** the user leaves the successor department empty
- **THEN** the pairing persists a null `successor_department_id` and the UI states the successor is created in the source document's department

#### Scenario: Only the active company's departments are offered

- **WHEN** the user opens the successor department picker
- **THEN** only active departments of the active company are listed

#### Scenario: Hidden when auto-create is off

- **GIVEN** a successor pairing with auto-create off
- **WHEN** the user views it
- **THEN** no successor department field is shown, since a manual create-from takes the creating user's department

#### Scenario: Hidden without permission

- **WHEN** a user without `DOC_CONFIG_MANAGE` views the pairings
- **THEN** the successor department control is not shown
