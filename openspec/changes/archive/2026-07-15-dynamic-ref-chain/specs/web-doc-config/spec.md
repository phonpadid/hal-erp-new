## ADDED Requirements

### Requirement: Reference-Chain Pairing Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user view and edit the reference-chain
pairings of a document type **owned by the active company** — the successor types that may
be created from it and the predecessor types it may be created from — persisted as
`document_type_ref` rows. Both sides of every pairing SHALL be document types of the active
company; the picker SHALL offer only active-company types and SHALL exclude the type itself.
Adding a pairing that already exists SHALL be prevented. The control SHALL show and hide by
the `DOC_CONFIG_MANAGE` permission code from the active-company context, mirroring the
server scope; the client guard is UX only and the server still enforces company isolation
and the permission.

#### Scenario: View a type's pairings

- **WHEN** a `DOC_CONFIG_MANAGE` user opens a document type's configuration
- **THEN** its allowed successor types and predecessor types are listed from `document_type_ref`

#### Scenario: Add a successor pairing

- **WHEN** the user adds a successor type (e.g. PO) to a predecessor type (e.g. PR)
- **THEN** a `document_type_ref` row PR→PO is created for the active company and appears in the list

#### Scenario: Remove a pairing

- **WHEN** the user removes an existing pairing
- **THEN** the corresponding `document_type_ref` row is deleted and it no longer permits that create-from

#### Scenario: Only active-company types are selectable

- **GIVEN** company A and company B own document types
- **WHEN** a user manages pairings while company B is active
- **THEN** only company B's types are offered as pairing endpoints

#### Scenario: Duplicate pairing is prevented

- **WHEN** the user attempts to add a pairing that already exists for the active company
- **THEN** the app prevents it and surfaces a validation message

#### Scenario: Non-manager cannot edit pairings

- **WHEN** a user without `DOC_CONFIG_MANAGE` views a document type
- **THEN** the pairing editor is hidden or read-only, and any mutation is rejected by the server
