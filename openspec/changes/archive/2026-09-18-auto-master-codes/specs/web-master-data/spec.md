## MODIFIED Requirements

### Requirement: Create and Edit Master Records

The web app SHALL let a `MASTER_MANAGE` user create and edit vendors and items through a form
validated client-side against a schema that mirrors the backend DTO (shared as the single source
of truth). Invalid input SHALL be blocked before submit. The create form SHALL NOT ask for a code:
the code is issued by the server, the form SHALL say so, and the issued code SHALL be shown to
the user once the record is saved. The edit form SHALL show the code read-only.

#### Scenario: Required field blocks save

- **WHEN** the user submits a vendor or item form with a required field empty
- **THEN** a validation error is shown and nothing is sent to the server

#### Scenario: Valid record is created

- **WHEN** the user submits a valid new vendor or item
- **THEN** it is created and appears in the registry

#### Scenario: The create form has no code field

- **WHEN** the user opens the new-vendor or new-item dialog
- **THEN** no code input is shown, and a hint says the code will be assigned on save

#### Scenario: The issued code is shown after save

- **WHEN** a new vendor or item is saved
- **THEN** the confirmation names the code the server issued (e.g. `V-00007`)

#### Scenario: The code is read-only on edit

- **WHEN** the user opens an existing vendor or item
- **THEN** its code is displayed and cannot be changed
