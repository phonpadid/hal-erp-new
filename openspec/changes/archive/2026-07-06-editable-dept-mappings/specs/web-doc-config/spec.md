## MODIFIED Requirements

### Requirement: Department Document Mapping

The web app SHALL let a `DOC_CONFIG_MANAGE` user map a department to a (document type → form
template + workflow), list the active company's mappings, and **edit an existing mapping** to
change its workflow, form template, and active state. A mapping makes that document type
creatable in that department. Edit input SHALL be validated client-side against a shared schema
mirroring the update DTO. When the server rejects a duplicate `(department, document type)` with
a conflict, the UI SHALL surface a clear message rather than a generic error. Edit affordances
SHALL require `DOC_CONFIG_MANAGE` and SHALL NOT alter company scope or the permission guard.

#### Scenario: Map a department to a document type

- **WHEN** the user maps a department to a document type with a template and workflow
- **THEN** the mapping appears in the list for the active company

#### Scenario: Edit a mapping's workflow

- **GIVEN** an existing mapping in the list
- **WHEN** the user opens its edit affordance, selects a different workflow, and saves
- **THEN** the mapping row reflects the new workflow

#### Scenario: Duplicate mapping surfaces a clear message

- **WHEN** the user tries to create a mapping for a department + document type that is already mapped
- **THEN** the UI shows a conflict message identifying the duplicate rather than a generic failure
