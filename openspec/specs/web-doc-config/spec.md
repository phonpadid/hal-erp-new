# web-doc-config

## Purpose
The Vue configuration-administration area that makes document behavior configuration, not
code. A `DOC_CONFIG_MANAGE` user manages document types and their `requires_budget` /
`requires_quota` / `post_action` flags, builds and publishes versioned form templates with
their fields, and maps a department to a (document type → form template + workflow) so that
type becomes creatable in that department. Approval workflows and their steps are managed by a
`WORKFLOW_MANAGE` user so mappings can route documents. The Configuration area is scoped to the
active company, and its navigation, lists, and actions are gated by permission code as a
UX-only guard; the server remains authoritative and enforces company scope.
## Requirements
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

### Requirement: Form Template and Field Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user, per document type, create a form template, add
fields and publish a template. The forms builder SHALL present a master–detail layout: the user
selects a document type and then a specific template **version** whose status
(DRAFT/PUBLISHED/RETIRED) and field count are clearly shown, with the active selection visually
highlighted. The field editor SHALL support the full field-type set
(`text`, `number`, `date`, `dropdown`, `file`, `line_items`), let the user edit a `dropdown`
field's choices (`options_json`), set a field's show/hide rule (`condition_json`) by referencing
another field on the same template with an operator and value, edit an existing field, and
reorder fields. When adding a field the sort order SHALL be assigned automatically so the user
does not enter an order number by hand. The builder SHALL show a live preview that renders the
selected template's fields as an end user would see them. Published templates are immutable in
the UI; the builder SHALL only offer add/edit/reorder affordances while a template is DRAFT and
otherwise show the template as locked. Further changes create a new version, and a published
template MAY be retired. All field input SHALL be validated client-side against the shared schema.

#### Scenario: Build and publish a form

- **WHEN** the user creates a template for a type, adds fields, and publishes it
- **THEN** the template shows as published with its fields

#### Scenario: Select a template version

- **WHEN** the user picks a document type and then a template version
- **THEN** that version becomes the active selection, its status and field count are shown, and its fields load in the field list and preview

#### Scenario: Fields are listed in order

- **WHEN** the user views a template's fields
- **THEN** they appear ordered by sort order

#### Scenario: Live preview reflects the fields

- **WHEN** the user views a template that has fields
- **THEN** the builder renders a preview of those fields as an end-user form, honoring each field's label, type, and required flag

#### Scenario: Add a field without entering a sort order

- **WHEN** the user adds a field to a DRAFT template
- **THEN** the field is appended after the existing fields with an automatically assigned sort order

#### Scenario: Edit an existing field

- **WHEN** the user edits a field on a DRAFT template and saves changes to its name, label, type, required flag, dropdown choices, or show/hide rule
- **THEN** the changes are persisted and reflected in the field list and preview

#### Scenario: Edit dropdown choices

- **WHEN** the user adds a `dropdown` field and enters its choices
- **THEN** the choices are saved as `options_json` and shown when the field renders

#### Scenario: Set a conditional show/hide rule

- **WHEN** the user gives a field a rule referencing another field's value
- **THEN** the rule is saved as `condition_json` for that field

#### Scenario: Add a file or line-items field

- **WHEN** the user adds a field of type `file` or `line_items`
- **THEN** the field is saved with that type and the document form will capture attachments or line rows accordingly

#### Scenario: Reorder fields

- **WHEN** the user changes a field's position
- **THEN** the new sort order is persisted and reflected in the field list

#### Scenario: Published template is locked

- **WHEN** the user selects a PUBLISHED or RETIRED template version
- **THEN** the builder shows it as locked with no add, edit, or reorder affordances, while still allowing a published template to be retired

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

### Requirement: Workflow and Step Management

The web app SHALL let a `WORKFLOW_MANAGE` user list and create workflows and add steps, so a
mapping can route documents. The step editor SHALL let the user choose the approver as either a
company role (`approverRoleId`) or a specific person (`approverUserId`), set the step's amount
range (`amountMin`/`amountMax`), the approval mode (SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY),
and the SLA hours. The workflow editor SHALL let the user express the workflow's selection
condition by amount band and position level (`job_level`), mirrored by the shared Zod schema so
client and server validation agree.

The web app SHALL additionally provide a per-workflow **detail view** on its own
directly-linkable route (`/doc-config/workflows/:workflowId`), reachable from the Workflows
list. The detail view SHALL show the workflow header (name and active state) and its selection
condition (amount band and position/job levels) as a readable summary, and SHALL list the
workflow's steps in full — step number, name, resolved approver (the role name or the person's
display label), amount range, approval mode, SLA hours, and any per-step condition — rather than
as collapsed chips. The detail view SHALL let a `WORKFLOW_MANAGE` user add a step from that
page. The route SHALL be gated by permission code as a UX-only guard, with the server remaining
authoritative for company scope and permission enforcement. An unknown `:workflowId` SHALL show
a not-found state rather than an error.

The web app SHALL additionally let a `WORKFLOW_MANAGE` user **edit and remove** workflows and
steps. The user SHALL be able to rename a workflow, edit its selection condition, and toggle its
active state; delete a workflow; edit an existing step (reusing the step form and its
client-side validation); and delete a step. Destructive actions (delete workflow, delete step)
SHALL require an explicit confirmation in the UI. These affordances SHALL be gated by permission
code as a UX-only guard; the server remains authoritative and MAY reject an edit or delete
(e.g. a workflow still referenced by a mapping or a document, or a step whose workflow has an
in-flight document), in which case the UI SHALL surface the server's reason rather than fail
silently.

#### Scenario: Create a workflow with a step

- **WHEN** the user creates a workflow and adds an approver step
- **THEN** the workflow lists that step

#### Scenario: Assign a specific person as approver

- **WHEN** the user adds a step and selects a specific person instead of a role
- **THEN** the step is saved with `approverUserId` and the person is shown as the approver

#### Scenario: Set a step amount range

- **WHEN** the user sets `amountMin` and/or `amountMax` on a step
- **THEN** the values are validated client-side and saved, and an inverted range
  (`amountMin` greater than `amountMax`) is rejected before sending

#### Scenario: Set a workflow level condition

- **WHEN** the user sets a position-level selection condition on a workflow
- **THEN** it is saved to the workflow's selection condition and shown in the workflow summary

#### Scenario: Open a workflow's detail view

- **WHEN** the user selects a workflow from the Workflows list
- **THEN** they are taken to that workflow's detail route showing its name, active state,
  selection condition, and every step's full configuration (approver, amount range, mode,
  SLA, and condition)

#### Scenario: Workflow detail is directly linkable

- **WHEN** the user navigates directly to a workflow's detail route (e.g. after a refresh or
  from a shared link)
- **THEN** the workflow's detail is shown, loading the workflow data if it is not already in
  memory

#### Scenario: Add a step from the detail view

- **WHEN** a `WORKFLOW_MANAGE` user adds a step from a workflow's detail view
- **THEN** the step is saved and appears in that workflow's step list on the detail view

#### Scenario: Unknown workflow id

- **WHEN** the user navigates to a detail route whose `:workflowId` matches no workflow in the
  active company
- **THEN** a not-found state is shown with a way back to the Workflows list, not an error

#### Scenario: Rename a workflow and toggle its active state

- **WHEN** a `WORKFLOW_MANAGE` user renames a workflow or toggles its active state
- **THEN** the change is saved and reflected in the list and detail view

#### Scenario: Edit an existing step

- **WHEN** the user edits a step's approver, amount range, mode, SLA, or condition and saves
- **THEN** the updated values are validated client-side and shown on the workflow's step list

#### Scenario: Delete a step with confirmation

- **WHEN** the user deletes a step and confirms the action
- **THEN** the step is removed from the workflow's step list

#### Scenario: Delete a workflow with confirmation

- **WHEN** the user deletes a workflow and confirms the action
- **THEN** the workflow is removed from the list, or, if the server rejects the deletion, the
  reason is surfaced and the workflow remains

#### Scenario: Server rejection is surfaced

- **WHEN** the user attempts a delete or edit that the server rejects (e.g. a referenced
  workflow or an in-flight step change)
- **THEN** the UI shows the server's reason and leaves the workflow or step unchanged

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

