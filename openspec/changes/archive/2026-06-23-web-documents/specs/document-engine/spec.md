## ADDED Requirements

### Requirement: Requester-Facing Creation Metadata

The system SHALL let a `DOC_CREATE` user discover what they can create without
`DOC_CONFIG_MANAGE`: the document types enabled for their active department (via
`dept_doc_type`) and the form fields of a type's mapped template. These reads SHALL be
scoped to the active company/department.

#### Scenario: List creatable types for the active department

- **WHEN** a `DOC_CREATE` user requests their creatable document types
- **THEN** the response lists the types mapped to their active department with each type's
  `requires_budget` / `requires_quota` flags

#### Scenario: Fetch a type's form fields for rendering

- **WHEN** a `DOC_CREATE` user requests the form for a creatable type
- **THEN** the mapped template's fields (name, label, type, required, order) are returned so
  the client can render the form
