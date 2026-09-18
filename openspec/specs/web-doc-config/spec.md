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

The list SHALL be narrowable by department, by document type and by active state, applied
server-side and composing with each other and with the search term. Each SHALL reset the list to its
first page.

The screen shows a department column, a document type column and an active column and offered no way
to narrow by any of them, so the question it exists to answer — which document types may this
department raise — could only be approached by guessing a word the department's name shares or by
reading every page. The columns a reader is shown are the dimensions they will try to narrow by.

The department options SHALL come from the departments that hold a mapping, not from the
organisation directory: that directory requires `DEPARTMENT_VIEW`, which a `DOC_CONFIG_MANAGE`
holder need not have, and a filter must never offer an option that yields nothing.

The active filter SHALL distinguish three states — unset, active, inactive — and SHALL NOT default
to active. "Show me the deactivated ones" is the question worth asking, and a control that hides
them by default cannot answer why a department lost a document type.

With a narrowing applied the screen SHALL state how many mappings it is showing out of how many
exist, so a narrowed list is not mistaken for the whole configuration. A filter can be left set and
forgotten in a way a search box cannot.

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

#### Scenario: Narrow the list to one department

- WHEN a `DOC_CONFIG_MANAGE` user filters the mapping list by a department
- THEN only that department's mappings are shown, and the list returns to its first page

#### Scenario: Filters compose with each other and with search

- WHEN the user filters by a department and a document type and also types a search term
- THEN the list shows only the mappings matching all three

#### Scenario: The department options offer only departments that have a mapping

- WHEN the user opens the department filter
- THEN it offers the departments holding at least one mapping, and offers no option that would
  yield an empty list

#### Scenario: Deactivated mappings are not hidden by default

- GIVEN a company with a deactivated mapping
- WHEN a `DOC_CONFIG_MANAGE` user opens the mapping list without choosing an active filter
- THEN the deactivated mapping is shown alongside the active ones

#### Scenario: A narrowed list says what it is hiding

- WHEN any filter is applied
- THEN the screen states how many mappings are shown out of how many exist in the company

### Requirement: Workflow and Step Management

The web app SHALL let a `WORKFLOW_MANAGE` user list and create workflows and add steps, so a
mapping can route documents. The step editor SHALL let the user choose the approver as either a
company role (`approverRoleId`) or a specific person (`approverUserId`), set the step's amount
range (`amountMin`/`amountMax`), the approval mode (SEQUENTIAL / PARALLEL_ALL / PARALLEL_ANY),
and the SLA hours. The step editor SHALL additionally let the user name an **escalation target** —
a company role or a specific person — which is who may act on the step once its SLA has elapsed.
The approver and escalation-target options offered SHALL be the active company's own roles and its
own members, so a step cannot be authored against a principal the server would refuse.

The editor SHALL make plain that leaving the escalation target empty means the step is chased rather
than skipped: nothing about a missed SLA removes an approval. The step
editor SHALL let the user set the step's "Engage for levels"
condition in one of two mutually exclusive modes: an **explicit list** of job levels or a
**minimum rank** threshold. The job-level options offered SHALL be sourced from the active
company's active `job_level` master rows (never a hardcoded level set), so the condition and the
requester's level always reference the same value set; the editor SHALL prevent authoring both an
explicit list and a rank threshold on the same step.

The workflow editor SHALL NOT offer a workflow-level selection condition. A workflow is chosen by
its `dept_doc_type` mapping, and every condition that changes routing is authored on a step, so the
editor SHALL present exactly the conditions that decide something.

The web app SHALL additionally provide a per-workflow **detail view** on its own
directly-linkable route (`/doc-config/workflows/:workflowId`), reachable from the Workflows
list. The detail view SHALL show the workflow header (name and active state), and SHALL list the
workflow's steps in full — step number, name, resolved approver (the role name or the person's
display label), amount range, approval mode, SLA hours, escalation target, and any per-step
condition (the explicit level list or the minimum-rank threshold) — rather than as collapsed chips. The detail view SHALL
let a `WORKFLOW_MANAGE` user add a step from that page. The route SHALL be gated by permission
code as a UX-only guard, with the server remaining authoritative for company scope and permission
enforcement. An unknown `:workflowId` SHALL show a not-found state rather than an error.

The web app SHALL additionally let a `WORKFLOW_MANAGE` user **edit and remove** workflows and
steps. The user SHALL be able to rename a workflow and toggle its
active state; delete a workflow; edit an existing step (reusing the step form and its
client-side validation); and delete a step. Destructive actions (delete workflow, delete step)
SHALL require an explicit confirmation in the UI. These affordances SHALL be gated by permission
code as a UX-only guard; the server remains authoritative and MAY reject an add, edit or delete
(e.g. a workflow still referenced by a mapping or a document, or an approver from another company),
in which case the UI SHALL surface the server's reason rather than fail silently.

Step edits SHALL NOT be presented as blocked while documents are in approval. Routing reads the
route recorded on each document, so an edit reaches documents submitted afterwards and reaches no
document already routing; the UI SHALL NOT warn about, disable, or explain a restriction the server
no longer applies.

#### Scenario: Create a workflow with a step

- **WHEN** the user creates a workflow and adds an approver step
- **THEN** the workflow lists that step

#### Scenario: Assign a specific person as approver

- **WHEN** the user adds a step and selects a specific person instead of a role
- **THEN** the step is saved with `approverUserId` and the person is shown as the approver

#### Scenario: Approver choices come from the active company

- **WHEN** the user opens the approver control on the step editor
- **THEN** the roles and people offered belong to the active company

#### Scenario: Name an escalation target on a step

- **WHEN** the user sets a step's escalation target to a role or a person and saves
- **THEN** it is stored on the step and shown on the step summary

#### Scenario: An empty escalation target is a valid choice

- **WHEN** the user saves a step with no escalation target
- **THEN** the step is saved, and the editor states that the step will be chased rather than skipped
  when its SLA elapses

#### Scenario: Set a step amount range

- **WHEN** the user sets `amountMin` and/or `amountMax` on a step
- **THEN** the values are validated client-side and saved, and an inverted range
  (`amountMin` greater than `amountMax`) is rejected before sending

#### Scenario: Engage-for-levels options come from the job-level master

- **WHEN** the user opens the "Engage for levels" control on the step editor
- **THEN** the selectable levels are the active company's active `job_level` rows, not a
  hardcoded list

#### Scenario: Set a step's explicit level list

- **WHEN** the user selects one or more job levels for a step in explicit-list mode
- **THEN** the step's condition is saved as `jobLevels` and shown on the step summary

#### Scenario: Set a step's minimum-rank condition

- **WHEN** the user chooses the minimum-rank mode and picks a threshold level
- **THEN** the step's condition is saved as `minRank` and the step summary describes it as
  "that level and above"

#### Scenario: Explicit list and rank threshold are mutually exclusive

- **WHEN** the user sets one condition mode on a step
- **THEN** the other mode's input is cleared/disabled so a step cannot carry both

#### Scenario: The workflow form offers no selection condition

- **WHEN** the user creates or renames a workflow
- **THEN** the form asks for its name and active state only, and no selection-condition input is
  presented anywhere in the workflow editor or its summary

#### Scenario: Open a workflow's detail view

- **WHEN** the user selects a workflow from the Workflows list
- **THEN** they are taken to that workflow's detail route showing its name, active state,
  and every step's full configuration (approver, amount range, mode, SLA, and condition)

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

- **WHEN** the user attempts an add, delete or edit that the server rejects (e.g. a referenced
  workflow, or an approver from another company)
- **THEN** the UI shows the server's reason and leaves the workflow or step unchanged

#### Scenario: Steps stay editable while documents are in approval

- **GIVEN** a workflow with documents currently in approval
- **WHEN** the user opens its step editor
- **THEN** the add, edit and delete affordances are available and carry no in-flight warning

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

### Requirement: Reference-Chain Pairing Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user view and edit the reference-chain
pairings of a document type **owned by the active company** — the successor types that may
be created from it and the predecessor types it may be created from — persisted as
`document_type_ref` rows. Both sides of every pairing SHALL be document types of the active
company; the picker SHALL offer only active-company types and SHALL exclude the type itself.
Adding a pairing that already exists SHALL be prevented. For a successor pairing the user SHALL
be able to set an **auto-create** flag indicating the successor is auto-created as a DRAFT on the
predecessor's full approval (the `CREATE_SUCCESSOR` post-action); the flag SHALL be shown per
successor pairing and be toggleable, defaulting to off. The control SHALL show and hide by
the `DOC_CONFIG_MANAGE` permission code from the active-company context, mirroring the
server scope; the client guard is UX only and the server still enforces company isolation
and the permission.

#### Scenario: View a type's pairings

- **WHEN** a `DOC_CONFIG_MANAGE` user opens a document type's configuration
- **THEN** its allowed successor types and predecessor types are listed from `document_type_ref`, each successor showing its auto-create state

#### Scenario: Add a successor pairing

- **WHEN** the user adds a successor type (e.g. PO) to a predecessor type (e.g. PR)
- **THEN** a `document_type_ref` row PR→PO is created for the active company and appears in the list

#### Scenario: Toggle auto-create on a successor pairing

- **WHEN** the user turns on auto-create for a successor pairing
- **THEN** the pairing's `auto_create` is persisted, so the successor is auto-created on the predecessor's approval; turning it off reverts to manual create-from

#### Scenario: Remove a pairing

- **WHEN** the user removes an existing pairing
- **THEN** the corresponding `document_type_ref` row is deleted and it no longer permits that create-from

#### Scenario: Only active-company types are selectable

- **GIVEN** company A and company B own document types
- **WHEN** a user manages pairings while company B is active
- **THEN** only company B's types are offered as pairing endpoints

#### Scenario: Duplicate pairing is prevented

- **WHEN** the user attempts to add a pairing that already exists for the active company
- **THEN** the app prevents it and surfaces a validation message

#### Scenario: Non-manager cannot edit pairings

- **WHEN** a user without `DOC_CONFIG_MANAGE` views a document type
- **THEN** the pairing editor is hidden or read-only, and any mutation is rejected by the server

### Requirement: Successor Department on a Ref-Chain Pairing

The web app SHALL let a `DOC_CONFIG_MANAGE` user set an optional successor department per successor pairing in the ref-chain editor, offering only active departments of the active company and defaulting to none. The control SHALL make clear that leaving it empty creates the successor in the source document's own department, and that setting it hands the successor to that department — the case that models procurement's real split, where the requesting department asks and the buying department buys. The field SHALL be shown only for a pairing with **auto-create** on, because it has no effect on a manual create-from, whose department comes from the user doing the creating. The control SHALL show and hide by the `DOC_CONFIG_MANAGE` permission code from the active-company context; the client guard is UX only and the server still enforces company isolation and the permission.

#### Scenario: Set a successor department

- **WHEN** a `DOC_CONFIG_MANAGE` user sets the successor department of an auto-create `PROC → PO` pairing to Procurement
- **THEN** the pairing's `successor_department_id` is persisted and shown in the list

#### Scenario: Empty means the source document's department

- **WHEN** the user leaves the successor department empty
- **THEN** the pairing persists a null `successor_department_id` and the UI states the successor is created in the source document's department

#### Scenario: Only the active company's departments are offered

- **WHEN** the user opens the successor department picker
- **THEN** only active departments of the active company are listed

#### Scenario: Hidden when auto-create is off

- **GIVEN** a successor pairing with auto-create off
- **WHEN** the user views it
- **THEN** no successor department field is shown, since a manual create-from takes the creating user's department

#### Scenario: Hidden without permission

- **WHEN** a user without `DOC_CONFIG_MANAGE` views the pairings
- **THEN** the successor department control is not shown

### Requirement: A Configuration Screen Says When A Setting Cannot Take Effect

The web app SHALL tell the administrator, at the moment of setting it, when a configuration value
cannot take effect because of another value in the same configuration, and SHALL name the
prerequisite rather than only the symptom.

Several settings are read only under a condition that another field controls. Set outside that
condition they save without complaint and are never read, so the screen is the only place the
administrator can learn it — the server is right to accept them, because each is harmless and the
prerequisite is editable, and the natural order of work is often to name the target before enabling
the mechanism that uses it.

The following SHALL be stated:

- **Auto-create on a reference pairing**, when the predecessor's post-action does not create
  successors. The flag is read only on the create-successor path, so no pairing from any other type
  is ever consulted.
- **The successor department on a pairing**, which is read only when an auto-created successor is
  being placed. Here the screen already declines to offer it at all unless auto-create is on, which
  settles the same question ahead of it being asked; it SHALL continue not to offer it.
- **An escalation target on a workflow step**, when the step has no SLA. Escalation is driven by a
  step being overdue, and a step with no SLA is never overdue.
- **An escalation target on a workflow step**, when the step's approve mode declines escalation.

The setting SHALL remain editable and the control SHALL NOT be disabled. Disabling it would refuse
the configuration by another means and would impose an order of work the screen invented; the
statement is advisory because the setting is harmless.

The condition SHALL be derived from configuration the screen already holds, without an additional
read. Where a rule is stated on a screen that the server also implements, the two SHALL be kept in
step — a screen that says a setting is inert when it is not is worse than a screen that says
nothing.

#### Scenario: Auto-create on a predecessor that creates no successors

- **GIVEN** a document type whose post-action does not create successors
- **WHEN** its reference-chain successors are configured
- **THEN** the screen states that auto-create will not run for this predecessor, and the switch
  remains settable

#### Scenario: Auto-create on a predecessor that does create successors

- **GIVEN** a document type whose post-action creates successors
- **WHEN** its reference-chain successors are configured
- **THEN** no such statement is shown

#### Scenario: A successor department without auto-create

- **GIVEN** a pairing whose auto-create is off
- **WHEN** its successors are configured
- **THEN** no successor department is offered for it, so none can be set inertly

#### Scenario: An escalation target on a step with no SLA

- **GIVEN** a workflow step with no SLA
- **WHEN** its escalation target is configured
- **THEN** the screen states that escalation needs an SLA before it can fire, and the target remains
  settable

#### Scenario: An escalation target on a step whose mode declines escalation

- **GIVEN** a workflow step in an approve mode that is chased rather than reassigned
- **WHEN** its escalation target is configured
- **THEN** the screen states that this mode does not escalate

#### Scenario: A step that can escalate says nothing

- **GIVEN** a workflow step with an SLA, in a mode that escalates
- **WHEN** its escalation target is configured
- **THEN** no such statement is shown

### Requirement: The Document Type Form Chooses The Printed Sheets

The document-type admin form SHALL let a `DOC_CONFIG_MANAGE` user choose the type's
`print_templates` from the closed set — official letter (ໃບສະເໜີ), purchase request (PR),
purchase order (PO) and receipt (ໃບເບີກຈ່າຍ) — presented as named choices rather than raw codes,
allowing several to be chosen, and defaulting to the official letter alone for a new type. The form SHALL show the type's stored value when
editing and SHALL send it on save. The choice SHALL be labelled so it is clear it affects only
what the document prints, not how it is routed or approved.

#### Scenario: Choosing the sheet a type prints

- **GIVEN** a `DOC_CONFIG_MANAGE` user editing a purchase-request type
- **WHEN** they choose the purchase-request sheet and save
- **THEN** the type is stored with `print_templates = PR` and documents of that type print that
  sheet

#### Scenario: Choosing both the letter and a form

- **WHEN** the user chooses the official letter and the purchase-request sheet and saves
- **THEN** both are stored, and a document of that type prints the letter followed by the form

#### Scenario: A new type defaults to the official letter

- **WHEN** the user opens the form to create a document type
- **THEN** the official letter is preselected

#### Scenario: The stored choice is shown when editing

- **GIVEN** a type stored with `print_templates = RECEIPT`
- **WHEN** the user opens it for editing
- **THEN** the receipt sheet is the selected choice

### Requirement: The Step Editor Offers The Payment-Evidence Requirement

The workflow step editor SHALL let a `WORKFLOW_MANAGE` user set whether the step requires a bank-transfer slip before it can be approved (`requiresPaymentSlip`), presented as a checkbox that is unchecked by default. The workflow detail view SHALL show the requirement on every step that carries it, alongside the step's approver, amount range, approval mode, SLA hours and escalation target, rather than leaving it discoverable only by opening the editor.

The client-side schema for the field SHALL mirror the server DTO, so client and server validation do not drift.

The editor SHALL state what the setting does in the approver's terms — that the step cannot be approved until a slip is attached, and that rejecting and returning stay available — because a setting that silently blocks an approval is indistinguishable from a broken step to the person it blocks.

Where the step's configured approver could never satisfy the requirement — the approver role or person holds no `PAYMENT_MANAGE` — the editor SHALL say so, following the existing rule that a configuration screen says when a setting cannot take effect. The editor SHALL NOT refuse the configuration on those grounds: the permission can be granted afterwards, and the screen's job is to make the consequence visible, not to decide it.

#### Scenario: Authoring the requirement on a step

- **GIVEN** a `WORKFLOW_MANAGE` user editing a workflow step
- **WHEN** the user checks the payment-evidence requirement and saves
- **THEN** the step is stored with `requiresPaymentSlip` true

#### Scenario: The default is off

- **WHEN** the user opens the editor for a step that has never carried the requirement
- **THEN** the checkbox is unchecked

#### Scenario: The requirement is visible without opening the editor

- **GIVEN** a workflow with one step requiring payment evidence
- **WHEN** a `WORKFLOW_MANAGE` user opens the workflow detail view
- **THEN** that step is shown as requiring evidence and the others are not

#### Scenario: An approver who could not satisfy the requirement is flagged

- **GIVEN** a step whose approver role holds no `PAYMENT_MANAGE`
- **WHEN** the user checks the payment-evidence requirement
- **THEN** the editor states that the configured approver cannot attach a slip
- **AND** the configuration can still be saved

### Requirement: A Refused Configuration Write Is Explained In The Reader's Language

The web app SHALL render every refusal a configuration screen shows — for a document type, a category, a form template or
field, a department mapping, a reference pairing, a workflow, a step or a delegation — from the server's message key through i18n, in en, la and zh, with the facts the server
sent (`typeCode`, `stepNo`, `status`, a category or workflow code) substituted in. The sentence
SHALL say what was refused and what to do about it, in the words of the screen — "post-action",
"ต้องใช้งบ"/"ຕ້ອງໃຊ້ງົບ", "pairing" — and SHALL NOT show a database id. A refusal the client has no
translation for SHALL show the server's English message rather than nothing.

The active-state switch on the document-type list SHALL, on a refusal, revert to the stored value
and show the refusal beside the row it belongs to, so the reader is not left with a switch that
says one thing and a database that says another. A refused ACTION on any configuration screen —
a toggle, a save, a delete — SHALL be reported as a toast and SHALL leave the list standing; it
SHALL NOT replace the content region with the page-load error state, which is for a read that
failed (web-app-layout, *Action Feedback and Confirmation*).

#### Scenario: The settle refusal reads in Lao

- **GIVEN** the interface language is Lao
- **WHEN** activating a type is refused because `CLAIM_RECOVERY` would be left reserving budget with
  no settlement
- **THEN** the toast reads, in Lao, that `CLAIM_RECOVERY` reserves budget with no way to settle it
  and names the two repairs (a settling post-action, or a pairing to a type that settles)

#### Scenario: A step that names nobody is explained by its number

- **WHEN** saving a workflow step with neither a role nor a person is refused
- **THEN** the toast names the step number and says an approver role or person is required, in the
  interface language

#### Scenario: A not-found never shows an id

- **WHEN** a configuration write is refused because its target no longer exists
- **THEN** the toast says the thing (the workflow, the mapping, the template) was not found, without
  a UUID

#### Scenario: The switch does not lie after a refusal

- **WHEN** toggling a document type's active switch is refused
- **THEN** the switch shows the stored value again, the refusal is toasted, and the list of types
  is still on screen — not replaced by an error panel with a retry button

### Requirement: The Document Type Form Offers The Paper Abbreviation

The document-type create and edit forms SHALL offer an optional **short name** field bound to
`document_type.short_name`, validated by the shared Zod schema with the same bound the server
applies (trimmed, at most 20 characters), and the list SHALL show it beside the code so an
administrator can see which types still stamp their code. The field's label and hint SHALL be
rendered through i18n in `en`, `la` and `zh`.

#### Scenario: Setting the abbreviation

- **WHEN** a `DOC_CONFIG_MANAGE` user edits a type and enters `ຈຊຈ` as its short name
- **THEN** the form sends `shortName` and the list shows `ຈຊຈ` beside that type's code

#### Scenario: Leaving it blank sends nothing

- **WHEN** the short-name field is left empty
- **THEN** the form sends `shortName` as null and the server stores null

