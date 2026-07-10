## MODIFIED Requirements

### Requirement: Document Type Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user list, create, and edit document types — setting
category and the `requires_budget` / `requires_quota` / `requires_vendor` / `requires_item` /
`post_action` flags and active state — validated client-side against a shared schema. The list
SHALL support a global text search over code and name, and SHALL additionally let the user filter
the list client-side by category, by active state, and by requirement flag (`requires_budget` /
`requires_quota` / `requires_vendor` / `requires_item`). Filters combine with each other and with
the global search using AND semantics; a cleared or empty filter imposes no constraint. Filtering
only narrows the already company-scoped list and SHALL NOT alter company scope or the permission
guard.

#### Scenario: Create a document type with flags

- **WHEN** a `DOC_CONFIG_MANAGE` user creates a document type with a category and flags
- **THEN** it appears in the list with those flags

#### Scenario: Edit a document type

- **WHEN** the user edits a type's flags or active state
- **THEN** the change is saved and reflected in the list

#### Scenario: Set the item-required flag

- **WHEN** a `DOC_CONFIG_MANAGE` user sets `requires_item` on a document type
- **THEN** the flag is saved, and documents of that type will require an item on every line

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
