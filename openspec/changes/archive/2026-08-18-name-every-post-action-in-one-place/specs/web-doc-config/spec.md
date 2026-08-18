# web-doc-config

## ADDED Requirements

### Requirement: The Post-Action Select Offers Every Action The Engine Runs

The document-type form's post-action control SHALL offer every value in the closed set, and SHALL
take that set from the shared declaration rather than from a list of its own. A screen that offers a
subset makes the missing actions configurable only by seeding the database, which is not
configuration — and it does so silently, because a shorter list looks complete.

The control MAY use a sentinel option to mean "no post-action", and SHALL resolve that sentinel to
`null` before the request is sent, so the sentinel is never stored.

Because the set is closed and the control is built from it, the form SHALL NOT need to append a
stored value as an extra option to keep the control from rendering blank.

#### Scenario: Every action is offered

- **WHEN** a `DOC_CONFIG_MANAGE` user opens the document-type form
- **THEN** the post-action control offers every action the engine dispatches, including the stock,
  voucher and budget-plan actions

#### Scenario: Choosing no post-action sends null

- **WHEN** the user leaves the post-action as the no-action option and submits
- **THEN** the request carries `null` rather than the sentinel string

#### Scenario: A stored action renders without a fallback option

- **GIVEN** a document type whose post-action is one the seed created
- **WHEN** the user opens it for editing
- **THEN** the control shows that action as a normal option of the list

## MODIFIED Requirements

### Requirement: Document Type Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user list, create, and edit document types **owned by
the active company** — selecting a `category` code from the active company's active categories (fetched
from the categories endpoint, not a hardcoded list), and setting the `requires_budget` /
`requires_quota` / `requires_vendor` / `requires_item` / `post_action` flags and active state, and an
optional `default_gl_account` (a GL code that auto-resolves an item-less line's budget on a
budget-controlled type) — validated client-side against a shared schema. The shared schema SHALL
constrain `post_action` to the closed set rather than accepting any string, so the client refuses the
same values the server refuses. Only the active company's
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

#### Scenario: A post-action outside the set fails client validation

- **WHEN** a document-type form is submitted with a post-action outside the closed set
- **THEN** the shared schema rejects it before a request is sent
