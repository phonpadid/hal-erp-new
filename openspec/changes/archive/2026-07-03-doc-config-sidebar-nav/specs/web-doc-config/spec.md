## ADDED Requirements

### Requirement: Configuration Section Navigation

The Configuration area SHALL present its four sub-areas — Document Types, Form Templates,
Department Mappings, and Workflows — as a permission-gated sub-sidebar (left navigation)
shown only within the Configuration area, rather than as tabs on a single page. Each
section SHALL have its own route so it is directly linkable, and the Configuration root
SHALL redirect to the first section the signed-in user may see. The sub-sidebar SHALL be
styled with theme tokens (working in both light and dark) and SHALL mark the active
section.

#### Scenario: Sections shown as a sub-sidebar

- **WHEN** a `DOC_CONFIG_MANAGE` user opens the Configuration area
- **THEN** the four sections appear as sub-sidebar links (no tab bar), with the current
  section marked active

#### Scenario: Each section is directly linkable

- **WHEN** the user navigates to a section's route (e.g. the Form Templates section)
- **THEN** that section is shown directly without first landing on another section

#### Scenario: Configuration root redirects to first section

- **WHEN** the user opens the Configuration area at its root path
- **THEN** they are redirected to the first section they are permitted to see

## MODIFIED Requirements

### Requirement: Permission-Gated Configuration

Document-type, form, and mapping affordances SHALL require `DOC_CONFIG_MANAGE`; workflow
affordances SHALL require `WORKFLOW_MANAGE` (UX only; the server still enforces). The
Configuration area SHALL be scoped to the active company. The Configuration sub-sidebar
and every section route SHALL be gated by `DOC_CONFIG_MANAGE`; a user without it SHALL
see neither the top-nav Configuration entry nor any section route.

#### Scenario: Configuration hidden without permission

- **WHEN** a user without `DOC_CONFIG_MANAGE` is signed in
- **THEN** the Configuration navigation entry is not shown

#### Scenario: Section route blocked without permission

- **WHEN** a user without `DOC_CONFIG_MANAGE` navigates directly to a Configuration
  section route
- **THEN** the route guard redirects them away and the section is not shown
