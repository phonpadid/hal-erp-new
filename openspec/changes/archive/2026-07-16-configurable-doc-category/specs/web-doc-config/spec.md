## ADDED Requirements

### Requirement: Document Category Management
The web app SHALL let a `DOC_CONFIG_MANAGE` user list, create, rename, and activate/deactivate
document categories **owned by the active company**, validated client-side against a shared schema
that mirrors the backend DTO. Only the active company's categories SHALL be listed, and a created
category SHALL be owned by the active company; its `code` SHALL be unique within that company. The
`code` field SHALL be editable only on create and shown read-only on edit (immutable), while `name`
and active state remain editable. The affordances SHALL be gated by `DOC_CONFIG_MANAGE` (UX only;
the server still enforces) and styled with theme tokens so light and dark both work. When the server
rejects a delete of a referenced category, the UI SHALL show the server's reason and offer
deactivation instead.

#### Scenario: Create a category
- **WHEN** a `DOC_CONFIG_MANAGE` user creates a category with a code and name
- **THEN** it appears in the list, owned by the active company, and becomes available as a document-type category option

#### Scenario: Category code is read-only on edit
- **WHEN** the user opens an existing category to edit
- **THEN** the code field is shown read-only, while the name and active state are editable

#### Scenario: Deactivate a category
- **WHEN** the user deactivates a category
- **THEN** it is marked inactive and is no longer offered as an option when creating a new document type, while existing types keep their category

#### Scenario: The list shows only the active company's categories
- **GIVEN** company A owns categories and company B owns different ones
- **WHEN** a user opens category management while company B is active
- **THEN** only company B's categories are listed; company A's are not shown

#### Scenario: Category management hidden without permission
- **WHEN** a user without `DOC_CONFIG_MANAGE` is signed in
- **THEN** the category management surface and its route are not shown

## MODIFIED Requirements

### Requirement: Document Type Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user list, create, and edit document types **owned by
the active company** — selecting a `category` code from the active company's active categories (fetched
from the categories endpoint, not a hardcoded list), and setting the `requires_budget` /
`requires_quota` / `requires_vendor` / `requires_item` / `post_action` flags and active state, and an
optional `default_gl_account` (a GL code that auto-resolves an item-less line's budget on a
budget-controlled type) — validated client-side against a shared schema. Only the active company's
types SHALL be listed, and a created type SHALL be owned by the active company; its `code` SHALL be
unique within that company (another company may own the same code). The list SHALL support a global
text search over code and name, and SHALL additionally let the user filter the list client-side by
category, by active state, and by requirement flag (`requires_budget` / `requires_quota` /
`requires_vendor` / `requires_item`). Filters combine with each other and with the global search
using AND semantics; a cleared or empty filter imposes no constraint. Filtering only narrows the
already company-scoped list and SHALL NOT alter company scope or the permission guard.

#### Scenario: Create a document type with flags

- **WHEN** a `DOC_CONFIG_MANAGE` user creates a document type, choosing a category from the fetched category options and setting flags
- **THEN** it appears in the list with those flags and category, owned by the active company

#### Scenario: Category options come from the active company's categories
- **GIVEN** the active company has defined its own set of categories
- **WHEN** the user opens the document-type create form
- **THEN** the category Select offers exactly that company's active categories, not a hardcoded list

#### Scenario: The list shows only the active company's types

- **GIVEN** company A owns document types and company B owns different ones
- **WHEN** a user opens document-type management while company B is active
- **THEN** only company B's types are listed; company A's are not shown

#### Scenario: Edit a document type

- **WHEN** the user edits a type's flags or active state
- **THEN** the change is saved and reflected in the list

#### Scenario: Set the item-required flag

- **WHEN** a `DOC_CONFIG_MANAGE` user sets `requires_item` on a document type
- **THEN** the flag is saved, and documents of that type will require an item on every line

#### Scenario: Set a default GL account

- **WHEN** a `DOC_CONFIG_MANAGE` user sets a `default_gl_account` on a budget-controlled
  document type
- **THEN** the value is saved, and an item-less line of that type will auto-resolve its budget
  from that GL

#### Scenario: Filter by category

- **WHEN** the user selects a category in the category filter
- **THEN** the list shows only document types in that category, and clearing the filter restores the full list

#### Scenario: Filter by active state

- **WHEN** the user selects Active (or Inactive) in the status filter
- **THEN** the list shows only types with that active state

#### Scenario: Filter by requirement flag

- **WHEN** the user selects one or more requirement flags (budget / quota / vendor / item)
- **THEN** the list shows only types that have every selected flag set

#### Scenario: Filters combine with search

- **WHEN** a global search term and one or more filters are active together
- **THEN** the list shows only rows matching the search term AND every active filter

#### Scenario: No rows match the active filters

- **WHEN** the active filters and search exclude every document type
- **THEN** the list shows the empty state rather than an error

### Requirement: Configuration Section Navigation

The Configuration area SHALL present its sub-areas — Document Types, Categories, Form Templates,
Department Mappings, and Workflows — as a permission-gated sub-sidebar (left navigation)
shown only within the Configuration area, rather than as tabs on a single page. Each
section SHALL have its own route so it is directly linkable, and the Configuration root
SHALL redirect to the first section the signed-in user may see. The sub-sidebar SHALL be
styled with theme tokens (working in both light and dark) and SHALL mark the active
section.

#### Scenario: Sections shown as a sub-sidebar

- **WHEN** a `DOC_CONFIG_MANAGE` user opens the Configuration area
- **THEN** the sections (including Categories) appear as sub-sidebar links (no tab bar), with the current
  section marked active

#### Scenario: Each section is directly linkable

- **WHEN** the user navigates to a section's route (e.g. the Form Templates section)
- **THEN** that section is shown directly without first landing on another section

#### Scenario: Configuration root redirects to first section

- **WHEN** the user opens the Configuration area at its root path
- **THEN** they are redirected to the first section they are permitted to see
