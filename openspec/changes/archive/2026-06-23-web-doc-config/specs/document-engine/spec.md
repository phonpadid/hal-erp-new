## ADDED Requirements

### Requirement: Configuration Read Surface

The system SHALL provide configuration reads under `DOC_CONFIG_MANAGE`, scoped to the active
company where applicable: a document type's form templates (version, status, field count) and the
active company's department-document mappings (department, document type, template version,
workflow). These complement the existing document-type list and template-field reads.

#### Scenario: List a type's form templates

- **WHEN** a `DOC_CONFIG_MANAGE` user requests the form templates for a document type
- **THEN** that type's templates are returned with their version and status

#### Scenario: List department mappings

- **WHEN** a `DOC_CONFIG_MANAGE` user requests the department-document mappings
- **THEN** the active company's mappings are returned with their document type, template, and
  workflow
