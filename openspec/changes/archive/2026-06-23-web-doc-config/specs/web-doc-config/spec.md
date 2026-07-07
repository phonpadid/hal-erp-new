## ADDED Requirements

### Requirement: Document Type Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user list, create, and edit document types — setting
category and the `requires_budget` / `requires_quota` / `post_action` flags and active state —
validated client-side against a shared schema.

#### Scenario: Create a document type with flags

- **WHEN** a `DOC_CONFIG_MANAGE` user creates a document type with a category and flags
- **THEN** it appears in the list with those flags

#### Scenario: Edit a document type

- **WHEN** the user edits a type's flags or active state
- **THEN** the change is saved and reflected in the list

### Requirement: Form Template and Field Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user, per document type, create a form template, add
fields (name, label, type, required, order, options), and publish a template. Published templates
are immutable; further changes create a new version.

#### Scenario: Build and publish a form

- **WHEN** the user creates a template for a type, adds fields, and publishes it
- **THEN** the template shows as published with its fields

#### Scenario: Fields are listed in order

- **WHEN** the user views a template's fields
- **THEN** they appear ordered by sort order

### Requirement: Department Document Mapping

The web app SHALL let a `DOC_CONFIG_MANAGE` user map a department to a (document type → form
template + workflow), and list the active company's mappings. A mapping makes that document type
creatable in that department.

#### Scenario: Map a department to a document type

- **WHEN** the user maps a department to a document type with a template and workflow
- **THEN** the mapping appears in the list for the active company

### Requirement: Workflow and Step Management

The web app SHALL let a `WORKFLOW_MANAGE` user list and create workflows and add steps (approver
role or user, amount range, approval mode, SLA hours), so a mapping can route documents.

#### Scenario: Create a workflow with a step

- **WHEN** the user creates a workflow and adds an approver step
- **THEN** the workflow lists that step

### Requirement: Permission-Gated Configuration

Document-type, form, and mapping affordances SHALL require `DOC_CONFIG_MANAGE`; workflow
affordances SHALL require `WORKFLOW_MANAGE` (UX only; the server still enforces). The
Configuration area SHALL be scoped to the active company.

#### Scenario: Configuration hidden without permission

- **WHEN** a user without `DOC_CONFIG_MANAGE` is signed in
- **THEN** the Configuration navigation entry is not shown
