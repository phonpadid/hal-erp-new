# Document Engine Specification

## Purpose
Configuration-driven documents: document types with behavior flags, versioned form
templates, per-department mapping, multi-line items, attachments, and safe numbering.
## Requirements
### Requirement: Configurable Document Type
The system SHALL define document types in `document_type`, **each owned by one company via
`company_id`**, with a `category` **code** that SHALL match an active `document_category` **of the
same company**, plus `requires_budget`, `requires_quota`, `requires_item`, **`requires_payee`**,
**`requires_warehouse`**, `default_gl_account`, and
`post_action`, so behavior is configured, not hardcoded. On create the system SHALL reject a
`category` code that is not an active category of the active company (the allowed set is data, not a
fixed enum) — the same code-reference validation `default_gl_account` uses, not a hard foreign key.
A type's `code` SHALL be unique **within its company** (`(company_id, code)`), so different companies
may each own the same code (e.g. `PR`). All document-type reads and writes (list, get, create,
update) SHALL be scoped to the active company (invariant 1); a type of another company is not
listable or resolvable. `requires_item` defaults to `false`; when `true`, every line of a document
of that type MUST carry an `item_id`. `default_gl_account` is optional; when set, an item-less line
of a `requires_budget` document resolves its budget from that GL so the requester need not pick one.
`requires_payee` defaults to `false`; when `true`, a document of that type MUST carry a payee bank
account before it can be submitted. `requires_payee` SHALL be independent of `post_action`: whether
a document names a bank account is a separate question from what settling it does to the budget, and
a type may need a payee without cutting budget or cut budget without naming one.

`post_action` is optional and SHALL be drawn from the closed set (see `The Post-Action Set Is Closed
and Declared Once`); `ISSUE_STOCK`, `ADJUST_STOCK` and `TRANSFER_STOCK` are members of it, so goods
issue, stock adjustment, and inter-warehouse transfer are configured document types rather than
hardcoded flows, inheriting workflow routing, forms, `approval_log`, delegation, and the
reject/cancel release hook like any other type.

`requires_warehouse` defaults to `false`; when `true`, a document of that type MUST carry a
`warehouse_id` that resolves to an active `warehouse` of the active company before it can be
submitted, and a type whose `post_action` is `TRANSFER_STOCK` MUST additionally carry a
`dest_warehouse_id` in the same company. A warehouse belonging to another company SHALL be
rejected (invariant 1). `requires_warehouse` SHALL be independent of `requires_item`: naming a
storage location is a separate question from whether every line names an item.

#### Scenario: A non-budget type skips budget steps
- GIVEN a document type with requires_budget=false and requires_quota=false
- WHEN a document of that type is submitted
- THEN no budget or quota transactions are created
- AND the document still enters its approval workflow

#### Scenario: A type category must be an active category of its company
- **GIVEN** company A has an active category `FINANCE` and company B has a category company A lacks
- **WHEN** a `DOC_CONFIG_MANAGE` user in company A creates a document type with a `category` code that is not an active category of company A
- **THEN** the create is rejected; using company A's active `FINANCE` code succeeds

#### Scenario: requires_item defaults off for existing types
- GIVEN a document type created without specifying `requires_item`
- WHEN a document of that type is submitted with a free-text (item-less) line
- THEN the submit is not rejected for a missing item

#### Scenario: requires_payee defaults off for existing types
- **GIVEN** a document type created without specifying `requires_payee`
- **WHEN** a document of that type is submitted with no payee bank account
- **THEN** the submit is not rejected for a missing payee

#### Scenario: A type default GL is optional and off by default
- GIVEN a document type created without a `default_gl_account`
- WHEN a requester adds an item-less line
- THEN no budget is auto-resolved from a type default, and the existing behavior is unchanged

#### Scenario: Types are scoped to the active company
- **GIVEN** company A owns a document type and company B owns none
- **WHEN** a user lists document types while company B is active
- **THEN** company A's type is not returned, and it cannot be resolved by id from company B

#### Scenario: The same code may exist in two companies
- **GIVEN** company A owns a type with code `PR`
- **WHEN** company B creates a type with code `PR`
- **THEN** creation succeeds (uniqueness is per company), and each company sees only its own `PR`

#### Scenario: requires_warehouse defaults off for existing types
- **GIVEN** a document type created without specifying `requires_warehouse`
- **WHEN** a document of that type is submitted with no warehouse
- **THEN** the submit is not rejected for a missing warehouse

#### Scenario: A warehouse-requiring type blocks submit without one
- **GIVEN** a document type with `requires_warehouse` true
- **WHEN** a document of that type is submitted with no `warehouse_id`
- **THEN** the submit is rejected and the document stays `DRAFT`

#### Scenario: A transfer type needs both warehouses
- **GIVEN** a document type whose `post_action` is `TRANSFER_STOCK`
- **WHEN** a document of that type is submitted naming a source warehouse but no `dest_warehouse_id`
- **THEN** the submit is rejected

#### Scenario: A warehouse of another company is rejected
- **WHEN** a document names a `warehouse_id` belonging to another company
- **THEN** the submit is rejected and no stock is reserved

### Requirement: A Field's Type Declares the Shape of Its Stored Value

`form_field.field_type` SHALL determine both the control the form renders and the shape of the value
stored in `doc_field_value`, and those two SHALL agree.

Only the rich-text types store markup. A field of any other type SHALL store the value itself: a
`number` stores a decimal string, a `date` stores an ISO `yyyy-mm-dd` string, a `dropdown` stores the
chosen option's value, and a `string` stores a single line of plain text. Writing a value that
carries markup to a field of one of those types SHALL be rejected.

The rule exists because a field type read as "which editor" and a field type read as "what the value
is" can disagree without anything failing until much later. A salary configured as a rich-text field
is stored as `<p>7500000</p>`, which no consumer parsing a decimal can accept — and the failure
surfaces at approval, in a post-action, to a person who did not fill the form in.

Where a post-action or any other consumer parses a field's value, the field's type SHALL be one whose
stored value can be parsed. Choosing a type whose control is convenient over one whose value is
correct is what this forbids.

#### Scenario: A numeric field stores a number

- **GIVEN** a form field whose type is `number`
- **WHEN** a document of that type is saved with a value entered in it
- **THEN** the stored value is a decimal string carrying no markup

#### Scenario: Markup in a non-rich field is rejected

- **WHEN** a value carrying markup is written to a field whose type is not a rich-text type
- **THEN** the write is rejected, naming the field

#### Scenario: A rich-text field may still store markup

- **GIVEN** a form field whose type is a rich-text type
- **WHEN** a value with formatting is saved
- **THEN** the markup is stored as entered

#### Scenario: A promotion's salary reaches its post-action parseable

- **GIVEN** a promotion document whose salary field was filled in through the form
- **WHEN** the document is fully approved
- **THEN** the post-action's salary guard accepts the value and the employee is updated

### Requirement: A Job Level Is Chosen From the Levels That Exist

A form field that carries an employee's job level SHALL offer the active company's `job_level`
records as its options rather than accepting free text.

`employee.job_level` is what the approval router compares against a step's minimum rank. A level
typed by hand that matches no configured level produces an employee the router cannot place, and the
document that set it looks no different from one that set a real level.

#### Scenario: The level comes from master data

- **WHEN** a promotion form renders its job-level field
- **THEN** the options are the active company's job levels

#### Scenario: A level that does not exist cannot be set

- **WHEN** a job level outside the company's configured levels is submitted
- **THEN** the submit is rejected

### Requirement: A Document Type Declares Where Its Content Is Authored

`document_type` SHALL carry a nullable `authoring_route`. `null` means the generic create form
authors this type's content. A value names the screen that does.

Some types keep their content outside `document_line` and `doc_field_value`, where the generic form
cannot reach it: a budget plan, adjustment and transfer carry `budget_movement` rows, and a journal
voucher carries `journal_voucher` lines. A generic form offered for such a type produces a document
that is well-formed and empty — it submits, enters the approval queue, and is refused by its
post-action when an approver finally acts on it.

The route SHALL NOT be derived from `post_action`. That column answers what full approval does, which
is a different question from where the content is written, and deriving one from the other puts the
answer in code rather than configuration (invariant 7).

Absence of a `dept_doc_type` mapping SHALL NOT be used to express this. Every document is created
through that mapping — including documents a dedicated screen creates — so a type without one cannot
be raised at all.

#### Scenario: A generically authored type carries no route

- **GIVEN** a document type whose content is document lines and field values
- **WHEN** its configuration is read
- **THEN** its `authoring_route` is null

#### Scenario: A type authored elsewhere names its screen

- **GIVEN** a document type whose content lives on `budget_movement` or `journal_voucher`
- **WHEN** its configuration is read
- **THEN** its `authoring_route` names the screen that authors it

#### Scenario: The mapping is still required

- **GIVEN** a document type whose `authoring_route` is set
- **WHEN** a document of that type is created by the screen that owns it
- **THEN** the department mapping still supplies its form template and workflow

### Requirement: A Document Type May Require an Employee

`document_type` SHALL carry `requires_employee`, defaulting to `false`. When `true`, a document of
that type MUST name a `related_employee` of the active company before it can be submitted. An
employee of another company SHALL be rejected (invariant 1).

The HR post-actions act on `document.related_employee` and are a logged no-op when it is absent. That
is correct for a post-action handed a document with no subject, and it is the wrong outcome to reach
from a form: a promotion that names nobody routes through every approval step, is approved, reaches
its terminal state, and changes no employee record. The approver is told it succeeded.

This flag SHALL be independent of `post_action`, like the other requirement flags: which document
names a person is a separate question from what approving it does.

#### Scenario: A promotion without an employee cannot be submitted

- **GIVEN** a document type with `requires_employee` true
- **WHEN** a document of that type is submitted naming no employee
- **THEN** the submit is rejected and the document stays `DRAFT`

#### Scenario: An employee of another company is rejected

- **WHEN** a document names a `related_employee` belonging to another company
- **THEN** the submit is rejected

#### Scenario: requires_employee defaults off

- **GIVEN** a document type created without specifying `requires_employee`
- **WHEN** a document of that type is submitted naming no employee
- **THEN** the submit is not rejected for a missing employee

### Requirement: A Document Whose Post-Action Needs Content It Lacks Is Refused At Submit

A document SHALL carry the content its post-action will need before it can be submitted. A budget
movement post-action (`ACTIVATE_BUDGET`, `TRANSFER`, `ADJUST_INCREASE`, `ADJUST_DECREASE`) requires
at least one `budget_movement` row; `POST_JOURNAL` requires a `journal_voucher`.

The post-actions already refuse these documents. Refusing them at submit instead moves the cost from
an approver to the person who can fix it: today such a document enters the queue, cannot be approved
however many times the approver tries, and leaves only by being withdrawn.

The submit check SHALL be a strict subset of what the post-action validates — that the content
exists — and SHALL NOT replace the post-action's own refusal, which still runs at the moment it acts.

#### Scenario: An empty budget plan is refused at submit

- **GIVEN** a budget plan document with no `budget_movement` rows
- **WHEN** it is submitted
- **THEN** the submit is rejected and the document stays `DRAFT`

#### Scenario: An empty voucher is refused at submit

- **GIVEN** a document whose type carries `POST_JOURNAL` and which has no `journal_voucher`
- **WHEN** it is submitted
- **THEN** the submit is rejected

#### Scenario: The post-action keeps its own refusal

- **GIVEN** a budget document whose movements were removed after it was submitted
- **WHEN** it is fully approved
- **THEN** the post-action still refuses and the approval rolls back

### Requirement: The Post-Action Set Is Closed and Declared Once

`post_action` SHALL be constrained to a fixed set of values, and that set SHALL be declared in one
place that both the client and the server read. The set SHALL be exactly the actions the engine
dispatches on full approval:

`CUT_BUDGET`, `TRANSFER`, `ADJUST_INCREASE`, `ADJUST_DECREASE`, `ACTIVATE_BUDGET`,
`CREATE_SUCCESSOR`, `ISSUE_STOCK`, `ADJUST_STOCK`, `TRANSFER_STOCK`, `POST_JOURNAL`,
`UPDATE_EMPLOYEE`, `TERMINATE_EMPLOYEE`.

A value outside the set SHALL be rejected when a document type is created or updated, SHALL be
rejected by the database, and SHALL NOT be reachable by the dispatcher. An unconstrained
`post_action` lets a misspelling configure a document type that routes through every approval step,
records the full `approval_log` trail, reaches its terminal state, and does nothing — a document that
was approved for an effect it never had, discoverable only when a balance is later questioned.

The set SHALL be declared once rather than restated per layer. A value list repeated across a schema,
a validator, a dispatcher and a reference document drifts silently, because nothing fails when one
copy is edited and the others are not.

The dispatcher SHALL be exhaustive over the set: adding a value without a branch SHALL be a build
failure rather than a document that approves and does nothing.

#### Scenario: An unknown post-action is refused at configuration

- **GIVEN** a `DOC_CONFIG_MANAGE` user creating a document type
- **WHEN** the request carries a `post_action` outside the set
- **THEN** the create is rejected and no document type is stored

#### Scenario: An unknown post-action is refused on update

- **GIVEN** an existing document type
- **WHEN** an update sets its `post_action` to a value outside the set
- **THEN** the update is rejected and the stored value is unchanged

#### Scenario: Every dispatched action is configurable

- **WHEN** the set of accepted `post_action` values is compared with the actions the engine
  dispatches
- **THEN** they are the same set, so no working action is unreachable from configuration and no
  configurable value is a no-op

### Requirement: A Document Type Means "No Post-Action" In One Way

Absence of a post-action SHALL be stored as `null`. A sentinel string SHALL NOT be stored for it.

Two stored spellings of the same intent cannot be told apart from a third value that was never
intended at all: a type configured to do nothing, a type whose value is a sentinel, and a type whose
value is a misspelling all reach the dispatcher's do-nothing path. Storing absence one way makes
"this type deliberately does nothing" a fact the data states rather than one a reader infers.

A client MAY use a sentinel to represent absence in a form control that cannot hold an empty value,
provided it resolves to `null` before the request is sent.

#### Scenario: A type created with no post-action stores null

- **WHEN** a document type is created without a post-action
- **THEN** its stored `post_action` is `null`

#### Scenario: A sentinel is not accepted as a stored value

- **WHEN** a create or update request carries a post-action sentinel rather than `null`
- **THEN** it is rejected like any other value outside the set

#### Scenario: A type with no post-action still approves

- **GIVEN** a document type whose `post_action` is `null`
- **WHEN** a document of that type is fully approved
- **THEN** it reaches its terminal state and no post-action runs

### Requirement: A Company Has At Most One Active Journal-Voucher Type

A company SHALL have at most one active document type whose `post_action` is `POST_JOURNAL`.
Creating or updating a type that would give a company a second one SHALL be rejected.

The voucher path resolves its document type by this post-action and refuses to proceed when a company
has more than one, so an unguarded second type moves the failure from the moment it was configured to
the next time somebody writes a voucher — where the person who caused it is absent and the error
describes a symptom rather than the act.

This constraint SHALL apply to `POST_JOURNAL` alone. The budget movement actions resolve zero, one or
many candidates and ask the caller to choose among them, which is deliberate.

#### Scenario: A second active voucher type is refused

- **GIVEN** a company with an active `POST_JOURNAL` document type
- **WHEN** a `DOC_CONFIG_MANAGE` user creates another active type with the same post-action
- **THEN** the create is rejected and the existing type is unchanged

#### Scenario: Replacing the voucher type is possible

- **GIVEN** a company whose only `POST_JOURNAL` type has been deactivated
- **WHEN** a new active `POST_JOURNAL` type is created
- **THEN** the create succeeds

#### Scenario: Two movement types of the same action are allowed

- **GIVEN** a company with an active `TRANSFER` document type
- **WHEN** a second active `TRANSFER` type is created
- **THEN** the create succeeds, and a movement naming neither is asked to choose between them

### Requirement: Configurable Document Category
The system SHALL define document categories in a company-scoped `document_category` table (config,
not a hardcoded enum), each owned by one company via `company_id`, with a `code`, a `name`, and an
`is_active` flag. A category's `code` SHALL be unique **within its company** (`(company_id, code)`),
so different companies may each own the same code (e.g. `FINANCE`). All category reads and writes
(list, get, create, update) SHALL be scoped to the active company (invariant 1); a category of
another company is not listable or resolvable. A category's `code` SHALL be immutable after
creation; its `name` and `is_active` MAY be updated. Managing categories SHALL require the
`DOC_CONFIG_MANAGE` permission code (invariant 6). A category whose `code` is referenced by any
`document_type` SHALL NOT be hard-deleted; it MAY only be deactivated (`is_active = false`).
Deactivating a category SHALL NOT change the `category` code stored on existing document types.

#### Scenario: Create a category scoped to the active company
- **WHEN** a `DOC_CONFIG_MANAGE` user creates a category with a code and name while company A is active
- **THEN** the category is owned by company A and appears only in company A's category list

#### Scenario: The same category code may exist in two companies
- **GIVEN** company A owns a category with code `FINANCE`
- **WHEN** company B creates a category with code `FINANCE`
- **THEN** creation succeeds (uniqueness is per company), and each company sees only its own `FINANCE`

#### Scenario: Category code is immutable
- **GIVEN** an existing category with code `HR`
- **WHEN** a `DOC_CONFIG_MANAGE` user updates it with a different code
- **THEN** the request is rejected and the code is unchanged, while the name and active state remain updatable

#### Scenario: A referenced category cannot be hard-deleted
- **GIVEN** a category referenced by at least one document type
- **WHEN** a `DOC_CONFIG_MANAGE` user attempts to delete it
- **THEN** the delete is rejected; deactivating it instead succeeds and leaves the referencing types' `category` code unchanged

#### Scenario: Categories are scoped to the active company
- **GIVEN** company A owns a category and company B owns none
- **WHEN** a user lists categories while company B is active
- **THEN** company A's category is not returned, and it cannot be resolved by id from company B

### Requirement: Per-Department Enablement
The system SHALL map which document types a department may use via `dept_doc_type`,
binding a form template and a workflow per mapping. A mapping SHALL be unique per
`(department, document_type)`; an attempt to create a second mapping for a pair that is
already mapped SHALL be rejected with a **conflict** error, not a server error. The mapped
department and document type MUST belong to the **same company**; mapping a department to a
document type owned by another company SHALL be rejected.

A `DOC_CONFIG_MANAGE` user SHALL be able to update an existing mapping's `workflow`,
`form_template`, and `is_active`. On update, the chosen form template MUST belong to the
mapping's document type and MUST NOT be `RETIRED` (the same rule as create). Update SHALL be
scoped to the active company: a mapping that belongs to another company SHALL be treated as
not found and SHALL NOT be modified. Because a `document` retains the `form_template_id` and
`workflow_id` it was created with, repointing a mapping SHALL affect only documents created
after the change, never in-flight or completed documents.

#### Scenario: Same type, different form per department
- GIVEN type "Expense" enabled for sales and for production with different templates
- WHEN a sales user creates an Expense
- THEN the sales-specific form template and workflow are applied

#### Scenario: Repoint a mapping to a different workflow
- GIVEN a `(Procurement, PR)` mapping bound to the "Standard Approval" workflow
- WHEN a `DOC_CONFIG_MANAGE` user updates the mapping's workflow to "Full Approval Chain"
- THEN the mapping now binds "Full Approval Chain"
- AND a PR created afterward in Procurement routes through that workflow
- AND any PR already in approval keeps the workflow it was created with

#### Scenario: Duplicate mapping is rejected with a conflict
- GIVEN a `(Procurement, PR)` mapping already exists
- WHEN a `DOC_CONFIG_MANAGE` user tries to create another `(Procurement, PR)` mapping
- THEN the request is rejected with a conflict error and no second row is written

#### Scenario: Update rejects a template that does not belong to the type
- GIVEN a `(Procurement, PR)` mapping
- WHEN the user updates it to a form template whose document type is not PR, or that is `RETIRED`
- THEN the request is rejected and the mapping is unchanged

#### Scenario: Update of another company's mapping is not found
- GIVEN a mapping that belongs to company B
- WHEN a `DOC_CONFIG_MANAGE` user whose active company is A tries to update it
- THEN the request is rejected as not found and no row is modified

#### Scenario: Mapping a cross-company type is rejected
- GIVEN a department in company A and a document type owned by company B
- WHEN an administrator tries to map that type to the department
- THEN the mapping is rejected because the department and type belong to different companies

### Requirement: Versioned Forms
The system SHALL version form templates; a document MUST retain the
`form_template_id` it was created with, even after the template is revised. A form template
SHALL be mutable only while its `status` is `DRAFT`: once `PUBLISHED` (and likewise once
`RETIRED`), the system SHALL reject adding or editing its `form_field` rows, so further changes
MUST be made on a new version. The system SHALL support a `PUBLISHED → RETIRED` transition.

#### Scenario: Old document keeps its form version
- GIVEN a document created on form template version 1
- WHEN the template is published as version 2
- THEN reopening the old document still renders version 1 fields

#### Scenario: Editing a published template is rejected
- GIVEN a form template whose `status` is `PUBLISHED`
- WHEN a `DOC_CONFIG_MANAGE` user tries to add or edit a `form_field` on it
- THEN the request is rejected with a conflict error and no `form_field` row is written

#### Scenario: Changes go to a new version
- GIVEN a `PUBLISHED` template for a document type
- WHEN the user creates a new template for that type
- THEN it is created as the next `version` with `status` `DRAFT` and is independently editable

#### Scenario: Retire a published template
- GIVEN a `PUBLISHED` template
- WHEN a `DOC_CONFIG_MANAGE` user retires it
- THEN its `status` becomes `RETIRED` and it can no longer be selected for new mappings

### Requirement: Dynamic Form Values
The system SHALL persist submitted field values in `doc_field_value` keyed by
`form_field_id`, supporting text, number, date, dropdown, file, and line-item types.

#### Scenario: Required field is enforced
- GIVEN a form field marked required
- WHEN a document is submitted without it
- THEN submission MUST be rejected with a validation error

### Requirement: Multi-Line Items with Per-Line Budget
The system SHALL support multiple `document_line` rows, each able to charge a distinct
budget and to track received quantity for 3-way matching.

#### Scenario: One document charges two budgets
- GIVEN a document with line 1 on budget A and line 2 on budget B
- WHEN submitted
- THEN each line reserves against its own budget independently

### Requirement: Attachments on External Storage
The system SHALL store attachment metadata in `document_attachment` and keep file
bytes on external object storage (S3/MinIO), never in the database. The system SHALL expose
an authenticated **upload** endpoint that receives the file bytes (multipart) and, after
validating the mime type against the image/document allow-list and enforcing a size cap on
the received bytes, writes them to the bucket server-side (backend → bucket) and records the
metadata; the file bytes SHALL NOT be uploaded by the browser directly to the bucket. Only
the resulting object key, file name, size, and mime type SHALL be persisted in
`document_attachment` (`file_path` holds the key). The upload endpoint SHALL be scoped to the
active company. For retrieval the system SHALL issue a short-lived presigned **download**
URL. The system SHALL list a document's attachments, scoped to the active company.

#### Scenario: Attach a receipt
- GIVEN a user uploads a PDF receipt to a document
- WHEN the upload completes
- THEN `document_attachment` stores the path, size, and mime type only

#### Scenario: File is uploaded through the API
- GIVEN a `DOC_CREATE` user in the active company selects a file for their document
- WHEN they POST the file bytes to the attachment upload endpoint
- THEN the backend validates and writes the bytes to object storage and returns the stored
  object key and attachment metadata, without the browser contacting the bucket directly

#### Scenario: Oversized or disallowed attachment is rejected
- GIVEN a user posts a file exceeding the size cap or with a mime type not in the allow-list
- WHEN the upload endpoint receives it
- THEN the request is rejected with a validation error and no object is written and no
  `document_attachment` row is created

#### Scenario: Presigned download URL is issued
- GIVEN a registered `document_attachment`
- WHEN a `DOC_VIEW` user requests its download URL
- THEN the system returns a short-lived presigned GET URL for the stored object key

### Requirement: Safe Document Numbering
The system SHALL generate document numbers per company, type, and year using a locked
counter in `doc_running_number`.

#### Scenario: Concurrent creation yields unique numbers
- GIVEN two documents of the same type created concurrently in one company-year
- WHEN numbers are issued
- THEN both numbers are unique and sequential, with no gaps from collision

### Requirement: Document Reference Chain
The system SHALL allow a document to reference a predecessor via `ref_document_id`
(e.g. PO references PR, advance-clearing references advance). When `ref_document_id` is set, the
system SHALL resolve the predecessor **within the active company** — a predecessor belonging to
another company SHALL resolve as not-found — SHALL require the predecessor's `status` to be
`APPROVED` or `COMPLETED`, and SHALL require the predecessor-type → new-type pairing to be
permitted by a `document_type_ref` row in the active company (configuration, not hardcoded per
type). The system SHALL provide a create-from-predecessor action that issues a `DRAFT` of the
target type with header fields and `document_line` rows copied from the predecessor; the copy
SHALL NOT create budget or quota holds. Each copied line SHALL carry the predecessor line's
`budget_id` and `tax_code_id`, so the successor charges the same budget and computes the same VAT
as the line it descends from. `gl_account` SHALL NOT be copied: it is re-derived from the item or
the chosen budget at write time, so the successor reflects the current configuration rather than a
stale stamp.

#### Scenario: PO links to its PR
- GIVEN an approved PR
- WHEN a PO is created from it
- THEN the PO's `ref_document_id` points to the PR

#### Scenario: Create-from copies header and lines
- GIVEN an `APPROVED` predecessor with multiple `document_line` rows
- WHEN a user creates a successor from it
- THEN a `DRAFT` successor is created with the header fields and lines copied, and no `budget_txn` or `quota_usage` rows are written

#### Scenario: Create-from carries the line tax code
- GIVEN an `APPROVED` predecessor whose line carries a VAT `tax_code_id`
- WHEN a successor is created from it and submitted
- THEN the successor's line carries the same `tax_code_id`
- AND the successor's `tax_total` and `grand_total` equal the predecessor's for the same line amount

#### Scenario: Referencing an unapproved predecessor is rejected
- GIVEN a predecessor whose `status` is `DRAFT` or `SUBMITTED`
- WHEN a document is created referencing it
- THEN the request is rejected with a validation error

#### Scenario: Cross-company predecessor is not-found
- WHEN a user references a predecessor `:id` that belongs to a different company
- THEN the request resolves as not-found (404) and no `document` is created

#### Scenario: Disallowed type pairing is rejected
- GIVEN no `document_type_ref` row in the active company permits the predecessor-type → target-type pairing
- WHEN a create-from is attempted across that pairing
- THEN the request is rejected with a validation error

#### Scenario: Pairing is resolved within the active company only
- GIVEN a `document_type_ref` pairing PR→PO exists in company A but not in company B
- WHEN a user in company B attempts to create a PO from a PR
- THEN the request is rejected with a validation error, because the pairing is not configured for company B

### Requirement: Reference-Chain Pairing Configuration
The system SHALL store allowed predecessor→successor document-type pairings as
`document_type_ref` rows, each scoped to a single company via `company_id`. Both
`predecessor_type_id` and `successor_type_id` SHALL reference `document_type` rows
belonging to the same company as the pairing; the system SHALL reject any attempt to
create a pairing whose two types are not both in that company. The combination
(`company_id`, `predecessor_type_id`, `successor_type_id`) SHALL be unique. Each pairing SHALL
carry an `auto_create` flag (default `false`) indicating whether the `CREATE_SUCCESSOR` post-action
auto-creates that successor on full approval of the predecessor; `DOC_CONFIG_MANAGE` users MAY set
it per pairing. Each pairing SHALL also carry a nullable `successor_department_id` naming the
department an auto-created successor is created in; when null the successor SHALL be created in
the source document's own department. The referenced department MUST belong to the pairing's
company, and the system SHALL reject a `successor_department_id` from another company. Configuring
the department on the pairing is what lets a chain hand off between departments — a `PROC` raised
by any department can produce its `PO` in Procurement — so the successor's routing follows the
configured chain rather than being inherited from whoever raised or approved the predecessor.
Reference-chain lookups (create-from validation and `CREATE_SUCCESSOR` successor
resolution) SHALL read these rows scoped to the active company and MUST NOT rely on any hardcoded
pairing table. The `CREATE_SUCCESSOR` post-action SHALL auto-create a DRAFT successor for **each**
successor pairing of the source type whose `auto_create` is `true` (zero, one, or many), and SHALL
do nothing when none are marked `auto_create`. Auto-creation SHALL be **guaranteed but deferred**:
the post-action records the obligation atomically with the approval and a sweep creates the DRAFT
shortly afterwards, so the successor is not observable on the approve response but is not
best-effort either — an obligation that cannot be fulfilled becomes a visible failure rather than
being dropped.

#### Scenario: Pairing requires same-company types
- GIVEN a predecessor type in company A and a successor type in company B
- WHEN an admin attempts to create a `document_type_ref` pairing between them
- THEN the request is rejected and no pairing row is written

#### Scenario: Duplicate pairing is rejected
- GIVEN a `document_type_ref` pairing PR→PO already exists in a company
- WHEN an admin attempts to create the same PR→PO pairing again in that company
- THEN the request is rejected as a duplicate

#### Scenario: CREATE_SUCCESSOR auto-creates each auto_create pairing
- GIVEN an approved document whose type has two successor pairings both marked `auto_create=true`
- WHEN the `CREATE_SUCCESSOR` post-action runs and its obligations are swept
- THEN a DRAFT successor is created for each of the two successor types, each referencing the source

#### Scenario: Only auto_create pairings are created
- GIVEN an approved document whose type has one successor pairing marked `auto_create=true` and another marked `auto_create=false`
- WHEN the `CREATE_SUCCESSOR` post-action runs and its obligations are swept
- THEN a DRAFT is created for the `auto_create=true` successor only, and the `auto_create=false` pairing remains available for manual create-from

#### Scenario: CREATE_SUCCESSOR is a no-op when no pairing is auto_create
- GIVEN an approved document whose type has no successor pairing marked `auto_create=true`
- WHEN the `CREATE_SUCCESSOR` post-action runs
- THEN it does nothing (logged) and the approval still completes

#### Scenario: The successor is not observable on the approve response
- GIVEN an approved document whose type has an `auto_create` pairing
- WHEN the successor is read immediately on the approve response, before the sweep runs
- THEN it does not exist yet, and it exists once the sweep has run

#### Scenario: A pairing lands its successor in the configured department
- **GIVEN** a `PROC → PO` pairing whose `successor_department_id` is Procurement, and a `PROC` raised in the IT department
- **WHEN** the obligation is swept
- **THEN** the `PO` is created in Procurement, with Procurement's form template and workflow

#### Scenario: A null successor department keeps the successor with the source
- **GIVEN** an `auto_create` pairing with a null `successor_department_id`, and a source document in the IT department
- **WHEN** the obligation is swept
- **THEN** the successor is created in the IT department

#### Scenario: A successor department from another company is rejected
- **GIVEN** a pairing in company A
- **WHEN** an admin sets its `successor_department_id` to a department of company B
- **THEN** the request is rejected

### Requirement: Document Submit Lifecycle

On submit the system SHALL, in a single transaction: validate that every required **and visible**
`form_field` has a value — a field whose `condition_json` evaluates to hidden is neither required
nor persisted; resolve and **lock** the FX rate at the submit date, stamping `exchange_rate`,
`base_total_amount`, and each line's `base_line_amount`; compute per-line input VAT from each
line's `tax_code` and stamp the line `tax_amount` and the document totals `sub_total` / `tax_total`
/ `grand_total` (a line with no tax code contributes `tax_amount` 0), with `base_total_amount`
reflecting the tax-inclusive grand total while the budget basis `budget_base_line_amount` stays
pre-tax (invariants 3, 4); reject the submit if the document's date falls in a CLOSED fiscal
period; reject any vendor or item not enabled for the active company; and then transition the
document from `DRAFT` to `SUBMITTED`. If any step fails, no holds are created and the document
stays `DRAFT`.

#### Scenario: Submit locks the FX rate and base amounts

- **WHEN** a foreign-currency document is submitted
- **THEN** `exchange_rate` and `base_total_amount` are stamped from the rate resolved at
  the submit date, and a later rate change does not alter them

#### Scenario: Submit computes VAT and document totals

- **GIVEN** a document with lines of net 1000 and 2000, each with a 7% VAT code
- **WHEN** it is submitted
- **THEN** `sub_total` is 3000, `tax_total` is 210, and `grand_total` is 3210, while the reserved
  budget uses the pre-tax line base

#### Scenario: Missing required field blocks submit

- **GIVEN** a required `form_field` with no `doc_field_value`
- **WHEN** the document is submitted
- **THEN** submission is rejected and the document remains `DRAFT`

#### Scenario: Hidden required field does not block submit

- **GIVEN** a required `form_field` whose `condition_json` evaluates to hidden for the document's values
- **WHEN** the document is submitted without a value for that field
- **THEN** submission is not blocked by that field and any stored value for it is ignored

#### Scenario: Submit into a closed period is rejected

- **WHEN** a budget-consuming document dated in a CLOSED fiscal year is submitted
- **THEN** submission is rejected with a closed-period error

### Requirement: Configuration-Driven Holds

Whether submit creates budget and quota holds SHALL be driven by the `document_type`
flags `requires_budget` and `requires_quota` — not by hardcoded per-type logic
(invariant 7). When `requires_budget` is true, submit SHALL reserve budget per line
grouped by `budget_id`; when `requires_quota` is true, submit SHALL reserve quota. On
cancel or reject the system SHALL release all of the document's budget and quota holds.

The release SHALL run after the transaction that records the terminal transition, and SHALL remain
idempotent, so recording the act and releasing what it held stay separable and a retry credits
nothing twice.

#### Scenario: Non-budget, non-quota type creates no holds

- **GIVEN** a document type with `requires_budget = false` and `requires_quota = false`
- **WHEN** a document of that type is submitted
- **THEN** no `budget_txn` and no `quota_usage` rows are created

#### Scenario: Budget type reserves per line

- **GIVEN** a `requires_budget` document with two lines on two different budgets
- **WHEN** it is submitted
- **THEN** one RESERVE is recorded against each budget for that line's base amount

#### Scenario: Cancel releases all holds

- **GIVEN** a submitted document holding budget (and/or quota) reservations
- **WHEN** it is cancelled
- **THEN** every reservation is released (budget RELEASE and quota RELEASE rows)

### Requirement: Authorized, Company-Scoped Document Operations

Configuration endpoints SHALL require `DOC_CONFIG_MANAGE`; runtime operations SHALL
require `DOC_VIEW` / `DOC_CREATE` / `DOC_SUBMIT` / `DOC_CANCEL` as appropriate, always by
permission code. Documents SHALL be company-scoped — both reads and content mutations
(field values in `doc_field_value`, lines in `document_line`) resolve a `document`
only within the active company. A request whose `:id` belongs to another company SHALL
resolve as not-found, never throw a server error, and never mutate across the
company-isolation boundary. A document is created in the active company with its number
issued from that company's counter. UUID path parameters SHALL be validated.

#### Scenario: Document numbering is per company, type, and year

- **WHEN** two documents of the same type are created concurrently in one company-year
- **THEN** both receive unique, sequential `doc_no` values with no collision

#### Scenario: Submitting without permission is forbidden

- **WHEN** a request without `DOC_SUBMIT` calls the submit endpoint
- **THEN** it is rejected with 403 before the handler runs

#### Scenario: Setting field values resolves the document within the active company

- **WHEN** a user sets field values for a document that exists in their active company
- **THEN** the values are persisted to `doc_field_value` for that document without error

#### Scenario: Mutating another company's document is not-found

- **WHEN** a user sets field values or lines for a document `:id` that belongs to a
  different company
- **THEN** the request is rejected as not-found (404) and no `doc_field_value` or
  `document_line` row is written

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

### Requirement: Filtered Document Listing

The document list endpoint SHALL accept optional filter parameters and apply them as additional
`where` conditions within the active-company scope and the existing pagination. The supported
filters are: `status` (one or more `doc_status` values), `documentTypeId` (`document_type_id`),
`departmentId` (`department_id`), `createdFrom`/`createdTo` (a `created_at` date range,
`createdTo` inclusive of the end day), `docNo` (case-insensitive contains match on `doc_no`),
`minAmount`/`maxAmount` (an inclusive range on `base_total_amount`), and `vendorId` (`vendor_id`).
Filters SHALL combine conjunctively; an omitted filter imposes no constraint. Amount bounds SHALL
be carried and compared as decimal strings and SHALL NOT be coerced to a JavaScript number.
Filtering SHALL only narrow results within the caller's active company — it SHALL NOT widen
visibility or return any `document` outside the active company, and a filter value that belongs to
another company SHALL match no rows rather than leak data. Filter inputs SHALL be validated
(enum membership, UUID format, date format, and a decimal pattern for amounts) and a malformed
value SHALL be rejected before the handler runs. The endpoint SHALL remain gated by `DOC_VIEW`.

#### Scenario: Filter by status returns only matching documents

- **WHEN** a `DOC_VIEW` user lists documents with `status=SUBMITTED`
- **THEN** only the active company's documents whose `status` is `SUBMITTED` are returned, within
  the normal page window

#### Scenario: Filters combine conjunctively

- **WHEN** the list is requested with both a `documentTypeId` and a `created_at` range
- **THEN** only documents matching that type AND falling within that date range are returned

#### Scenario: Amount range filters on the decimal string

- **WHEN** the list is requested with `minAmount` and `maxAmount`
- **THEN** only documents whose `base_total_amount` falls inclusively within the range are returned,
  compared as decimal values without coercing the amount to a JavaScript number

#### Scenario: A cross-company filter value leaks nothing

- **WHEN** a user filters by a `documentTypeId` or `vendorId` that exists only in another company
- **THEN** the result is empty and no document from another company is returned

#### Scenario: Malformed filter input is rejected

- **WHEN** the list is requested with an invalid filter value (e.g. a non-UUID `documentTypeId` or a
  non-decimal `minAmount`)
- **THEN** the request is rejected with a validation error before the list handler runs

#### Scenario: No filters preserves existing behavior

- **WHEN** the list is requested with only `page`/`limit` and no filters
- **THEN** the active company's documents are returned exactly as before this change

### Requirement: Conditional Field Visibility

The system SHALL evaluate a `form_field`'s `condition_json` to determine whether the field is
visible for a given set of `doc_field_value`s, using a single deterministic rule shape shared by
the client renderer and the server submit check so the two cannot drift. A `null`/absent
`condition_json` means always visible; otherwise the rule references another field on the same
template by `field_name` with a finite operator set (e.g. `eq`, `ne`, `in`, `nin`, `empty`,
`notEmpty`). Visibility SHALL govern both client rendering and the server's required-field
enforcement (see Document Submit Lifecycle).

#### Scenario: Field shown when condition is met
- GIVEN field B with `condition_json` requiring field A `eq` "Yes"
- WHEN field A's value is "Yes"
- THEN field B is visible and, if required, its value is enforced at submit

#### Scenario: Field hidden when condition is not met
- GIVEN field B with `condition_json` requiring field A `eq` "Yes"
- WHEN field A's value is "No"
- THEN field B is hidden and not required at submit

### Requirement: Form Field Type Validation

The system SHALL validate a `form_field`'s `field_type` against the allowed set
(`text`, `number`, `date`, `dropdown`, `file`, `line_items`) and SHALL reject any other value. A
`dropdown` field SHALL carry its choices in `options_json`. A `line_items` field SHALL denote that
the document captures `document_line` rows (stored via the lines endpoint, not in
`doc_field_value`); a `file` field SHALL denote attachment capture into `document_attachment`.

#### Scenario: Unknown field type is rejected
- WHEN a `DOC_CONFIG_MANAGE` user adds a `form_field` with a `field_type` outside the allowed set
- THEN the request is rejected with a validation error and no `form_field` row is written

#### Scenario: Dropdown carries options
- WHEN a `dropdown` field is created with `options_json`
- THEN the field is stored with its choices and the form read returns them for rendering

### Requirement: Document Detail Read Surface

The system SHALL return, for a single document read scoped to the active company, the document
header together with its `doc_field_value` values, its `document_line` rows, its
`document_attachment` metadata, and its predecessor reference (`ref_document_id` with the
predecessor's `doc_no`/`status`) so the client can render the full document.

#### Scenario: Detail returns fields, lines, attachments, and predecessor
- GIVEN a document with field values, lines, attachments, and a `ref_document_id`
- WHEN a `DOC_VIEW` user reads it within the active company
- THEN the response includes the field values, line items, attachment metadata, and the predecessor's `doc_no` and `status`

#### Scenario: Reading another company's document is not-found
- WHEN a user reads a document `:id` that belongs to a different company
- THEN the request resolves as not-found (404)

### Requirement: Item-Driven GL and Budget Resolution on Lines

When a document line references an `item`, the system SHALL derive the line's
`gl_account` from that item's **per-company GL — the active company's
`item_company.default_gl_account`** — server-authoritatively, ignoring any `gl_account` value
supplied by the client. From the derived `gl_account`, the document's `department_id`, and the
fiscal year whose `start_date`/`end_date` contains the document date, the system SHALL resolve
the line's `budget_id` to the single `budget` uniquely identified by
`(fiscal_year_id, department_id, gl_account)` whose `status` is `ACTIVE`. All lookups (item
enablement, fiscal year, budget) SHALL be scoped to the document's `company_id` (invariant 1).
The group `item` table carries no GL.

For a document type where `requires_budget` is true, the system SHALL reject line save or
submit when an item-backed line's item has **no `item_company.default_gl_account`** for the
active company, or when **no** `ACTIVE` budget matches the resolved
`(fiscal_year, department, gl_account)`; the error SHALL name the `gl_account`, department, and
fiscal year that failed to resolve.

A line that carries **no item** SHALL resolve its budget in this precedence: (1) an
explicitly selected `budget_id` wins and stamps the line's `gl_account` from that budget;
(2) otherwise, when the document's type sets a `default_gl_account`, the line's `gl_account`
is stamped from that type default and its `budget_id` is resolved **best-effort** from
`(fiscal_year, department, default_gl_account)` — an `ACTIVE` match is charged, and no match
simply leaves the line's budget unset (it is NOT rejected, unlike an item-backed line);
(3) otherwise the line carries no GL/budget from derivation. The submit-time budget-coverage
rule still applies to a positive-amount line.

This requirement changes only how a line's `gl_account` and `budget_id` are chosen. It does
not change budget reservation, conversion, or release (invariants 3–5), which continue to
act on the resolved `budget_id`.

#### Scenario: Item derives GL and resolves the budget

- **GIVEN** a `requires_budget` document in a department, with an item whose active-company
  `item_company.default_gl_account` is `5210` and an `ACTIVE` budget for that fiscal year,
  department, and `5210`
- **WHEN** the requester adds a line referencing that item
- **THEN** the line's `gl_account` is set to `5210` and its `budget_id` is set to the
  matching budget, without the requester choosing a GL or a budget

#### Scenario: Client-supplied GL on an item line is ignored

- **GIVEN** an item-backed line whose item's per-company GL is `5210`
- **WHEN** the client sends a different `gl_account` on save
- **THEN** the server overwrites it with the item's per-company GL and resolves the budget
  from that value

#### Scenario: Item without a per-company GL is rejected on a budget-required type

- **GIVEN** a `requires_budget` document and an item with no `item_company.default_gl_account`
  for the active company
- **WHEN** the requester tries to save or submit a line referencing that item
- **THEN** the operation is rejected with an error identifying the item as having no GL,
  and no budget is resolved

#### Scenario: No matching active budget is rejected for an item line

- **GIVEN** an item whose per-company GL is `5210` but no `ACTIVE` budget exists for
  the document's fiscal year, department, and `5210`
- **WHEN** the requester tries to save or submit that line
- **THEN** the operation is rejected with an error naming the `gl_account`, department, and
  fiscal year, and the line is not saved

#### Scenario: Item GL is company-scoped

- **GIVEN** an item whose `item_company.default_gl_account` is `5300` in company A and `5210`
  in company B
- **WHEN** an item line referencing it is created while company B is active
- **THEN** the line's `gl_account` is `5210` (company B's value), and company A's `5300` is
  never used

#### Scenario: Type default GL resolves an item-less line's budget

- **GIVEN** a `requires_budget` type whose `default_gl_account` is `5210`, and an `ACTIVE`
  budget for the document's fiscal year, department, and `5210`
- **WHEN** the requester adds a line with no item and no chosen budget
- **THEN** the line's `gl_account` is set to `5210` and its `budget_id` is resolved to that
  budget, without the requester picking a budget

#### Scenario: Explicit budget overrides the type default

- **GIVEN** a `requires_budget` type with a `default_gl_account`, and an item-less line for
  which the requester chose a different budget
- **WHEN** the line is saved
- **THEN** the chosen `budget_id` is used and the line's `gl_account` is stamped from that
  budget, not from the type default

#### Scenario: Unresolved type default degrades to the picker, not a rejection

- **GIVEN** a `requires_budget` type whose `default_gl_account` has no `ACTIVE` budget for the
  document's department and year
- **WHEN** the requester saves an item-less line with no chosen budget
- **THEN** the save is not rejected; the line carries the type-default `gl_account` with no
  budget, and the submit-time coverage rule still requires a budget for a positive amount

#### Scenario: Item-less line uses an explicitly selected budget

- **GIVEN** a `requires_budget` document line that references no item and whose type sets no
  `default_gl_account`
- **WHEN** the requester selects a budget from the selectable-budgets read and saves
- **THEN** the line stores that `budget_id` and no item-GL derivation is applied

#### Scenario: Resolution is company-scoped

- **WHEN** a line's item, fiscal year, and budget are resolved while company A is active
- **THEN** only company A's item enablement (and its per-company GL), fiscal year, and budget
  are considered, and no other company's budget can be resolved onto the line

### Requirement: Mandatory Item on Configured Types

When a document's type has `requires_item = true`, the system SHALL reject submit if the document has no lines at all, or if any line has no `item_id`, identifying the offending line where there is one, and SHALL leave the document DRAFT with no budget or quota reserved. A draft MAY be saved with item-less lines, or with none; the rule is enforced at submit (mirroring the `requires_vendor` completeness gate).

The empty case SHALL be rejected explicitly. A rule that every line carries an item is satisfied by a document with no lines, which is not what the flag asks: a type configured to require items exists to move or account for the things named on those lines, and a submitted document naming none of them consumes an approval chain to authorise nothing.

This SHALL NOT become a general requirement that a document has lines. A type that requires no items MAY still be submitted without any.

#### Scenario: Item-mandatory type rejects a free-text line at submit
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with a line that has no `item_id`
- **THEN** the submit is rejected identifying the line, and the document stays DRAFT

#### Scenario: Item-mandatory type rejects a document with no lines
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with no lines
- **THEN** the submit is rejected, and the document stays DRAFT with nothing reserved

#### Scenario: Item-mandatory type accepts lines that all carry an item
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with every line carrying an `item_id`
- **THEN** the submit is not rejected for a missing item

#### Scenario: A type that requires no items may still be submitted without lines
- **GIVEN** a document type with `requires_item = false`
- **WHEN** a document of that type is submitted with no lines
- **THEN** it is not rejected for having none

#### Scenario: A draft may still hold an item-less line
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a requester saves a draft with an item-less line
- **THEN** the draft is saved, and only submit enforces the item requirement

### Requirement: Complete Budget Coverage on Submit
On a document whose type has `requires_budget = true`, the system SHALL reject submit when
any line with a positive `line_amount` has no resolved `budget_id`, identifying the
offending line, and SHALL leave the document DRAFT with no budget reserved. A line with a
zero `line_amount` reserves nothing and is not required to carry a budget. This replaces any
weaker rule that only rejected a budget-controlled document with no budgeted line at all.

#### Scenario: A positive budget-less line is rejected
- **GIVEN** a `requires_budget` document with one budgeted line and one line whose
  `line_amount` is positive but which resolves no budget
- **WHEN** the document is submitted
- **THEN** the submit is rejected identifying the budget-less line, and the document stays
  DRAFT with no RESERVE created for any line

#### Scenario: Every positive line has a budget
- **GIVEN** a `requires_budget` document where every positive-amount line resolves a budget
- **WHEN** the document is submitted
- **THEN** the submit proceeds and one RESERVE is created per line's budget

#### Scenario: A zero-amount line need not carry a budget
- **GIVEN** a `requires_budget` document with budgeted positive lines and one zero-amount
  line that resolves no budget
- **WHEN** the document is submitted
- **THEN** the submit is not rejected for the zero-amount line, which reserves nothing

### Requirement: Personal-Quota Beneficiary Resolution at Submit

The system SHALL resolve the beneficiary of each quota reservation server-side, within the submit transaction, before writing `quota_usage`, when a document that has `requires_quota = true` is submitted. For a reservation whose target `quota` is entitlement-scoped (has any `quota_entitlement` row), the system SHALL set the reservation's `employee_id` to the document's `related_employee_id` when the document carries one, and otherwise to the submitting user's own linked `employee` in the active company. The system SHALL in all cases ignore any `employee_id` supplied by the client, so a requester can never reserve against another employee's entitlement by editing the request. A `related_employee_id` MUST belong to the document's own company. If the target quota is entitlement-scoped, the document carries no `related_employee_id`, and the submitting user has no linked employee in the active company, the system SHALL reject the submit with a clear error and write no `quota_usage` row. For a pool quota (no entitlements), the system SHALL reserve with no `employee_id`.

#### Scenario: Personal quota reserves against the submitter's own employee

- **GIVEN** a submitting user linked to an employee, and a `requires_quota` draft with no `related_employee_id` reserving from a personal quota
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is stamped with the submitter's own `employee_id`, regardless of any employee id in the request body

#### Scenario: A document naming a related employee charges that employee

- **GIVEN** a `requires_quota` draft whose `related_employee_id` names another employee of the same company
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is stamped with that employee, not the submitter — the case where HR files on behalf of staff who have no login account

#### Scenario: The request body still cannot choose a beneficiary

- **GIVEN** a `requires_quota` draft with no `related_employee_id`
- **WHEN** the submit request body supplies an `employee_id` for another employee
- **THEN** it is ignored and the submitter's own employee is charged

#### Scenario: A related employee from another company is rejected

- **WHEN** a document's `related_employee_id` names an employee of a different company
- **THEN** the submit is rejected and no `quota_usage` row is written

#### Scenario: Personal quota with no linked employee is rejected

- **GIVEN** a submitting user with no linked employee in the active company, on a document with no `related_employee_id`
- **WHEN** they submit a `requires_quota` draft reserving from a personal quota
- **THEN** the submit is rejected with a clear error and no `quota_usage` row is written

#### Scenario: Pool quota reserves with no employee

- **GIVEN** a `requires_quota` draft reserving from a pool quota (no entitlements)
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is written with a null `employee_id`

### Requirement: Derived-Quantity Types Are Submitted Through Their Own Capability

The system SHALL provide a `derives_quantity` flag on `document_type`, defaulting to false. When a document whose type has `derives_quantity` true is submitted through the generic submit endpoint, the system SHALL reject the submit, write no `quota_usage` or `budget_txn` row, and return an error naming the capability that owns the type. A type whose quantity is stated by the requester SHALL be unaffected.

This exists because a quantity that the system derives is not the client's to state. Generic submit cannot compute such a quantity itself — the rule belongs to a capability built after document-engine, which document-engine cannot import — so it declines instead, driven by configuration on its own table rather than by a dependency.

#### Scenario: A derived-quantity document is refused by generic submit

- **GIVEN** a document whose type has `derives_quantity` true
- **WHEN** it is submitted through the generic submit endpoint
- **THEN** the submit is rejected and no reservation of any kind is written

#### Scenario: The rejection tells the caller where to go

- **WHEN** a derived-quantity document is refused
- **THEN** the error identifies the endpoint that owns the type, rather than failing opaquely

#### Scenario: Ordinary types are unaffected

- **GIVEN** a document whose type has `derives_quantity` false
- **WHEN** it is submitted with a client-stated quantity
- **THEN** it submits exactly as before

#### Scenario: The flag defaults to false

- **GIVEN** a `document_type` created before this flag existed
- **WHEN** a document of that type is submitted
- **THEN** it behaves as it always has

### Requirement: Payee Bank Account on Types That Require One

The system SHALL carry a nullable `document.vendor_bank_account_id` and SHALL require it at submit when the document type's `requires_payee` is `true`, rejecting the submit otherwise. The referenced account MUST belong to the document's own `vendor` and MUST be active at submit. Binding the payee to the document is what carries it through the approval chain: the approvers who approve the amount also approve where the money lands, and no later actor can redirect an approved payment. The gate SHALL branch on `requires_payee` and SHALL NOT branch on `post_action`, per invariant 7 — a purchase requisition settles budget on approval without anyone yet knowing which account will be paid, so keying the payee off `CUT_BUDGET` would block requisitions that legitimately have no payee. The check SHALL sit alongside the existing `requires_vendor` gate, before any budget or quota hold is taken, so a rejected submit leaves the document `DRAFT` with nothing reserved.

#### Scenario: A payee-requiring document without a payee cannot be submitted

- **GIVEN** a `DRAFT` document whose type has `requires_payee` true and no `vendor_bank_account_id`
- **WHEN** it is submitted
- **THEN** the submit is rejected and no budget is reserved

#### Scenario: A payee from another vendor is rejected

- **GIVEN** a `requires_payee` document for vendor A referencing an account of vendor B
- **WHEN** it is submitted
- **THEN** the submit is rejected

#### Scenario: An inactive payee account is rejected at submit

- **GIVEN** a `requires_payee` document whose payee account was deactivated while it was `DRAFT`
- **WHEN** it is submitted
- **THEN** the submit is rejected

#### Scenario: A budget-cutting type without requires_payee needs no payee

- **GIVEN** a `DRAFT` document whose type has `post_action` `CUT_BUDGET` and `requires_payee` false
- **WHEN** it is submitted without a `vendor_bank_account_id`
- **THEN** the submit succeeds and the budget is reserved as before

#### Scenario: A rejected submit reserves nothing

- **GIVEN** a `requires_payee` document missing its payee
- **WHEN** the submit is rejected
- **THEN** the document is still `DRAFT` and no `budget_txn` row exists for it

### Requirement: The Approved Payee Is Immutable

The system SHALL reject any change to `document.vendor_bank_account_id` once the document has left `DRAFT`, so the destination that passed the approval chain is the destination that gets paid. A document returned to `DRAFT` SHALL allow the payee to be changed and SHALL require the whole chain to approve again, which is the only supported way to redirect an approved payment.

#### Scenario: The payee cannot be changed under approval

- **GIVEN** a `requires_payee` document in `IN_APPROVAL`
- **WHEN** its `vendor_bank_account_id` is changed
- **THEN** the request is rejected

#### Scenario: The payee cannot be changed after approval

- **GIVEN** a `COMPLETED` disbursement awaiting payment
- **WHEN** its `vendor_bank_account_id` is changed
- **THEN** the request is rejected

#### Scenario: Returning to draft reopens the payee

- **GIVEN** a document returned to `DRAFT` by an approver
- **WHEN** its payee account is changed and it is resubmitted
- **THEN** the change is accepted and the document routes through its approval steps again

### Requirement: A Draft's Type-Driven Selections Can Be Corrected

The system SHALL accept a change to `document.warehouse_id`, `document.dest_warehouse_id`,
`document.related_employee_id` and `document.vendor_id` while the document is `DRAFT`, and SHALL
reject any such change once it has left `DRAFT`. These are the selections a `document_type` asks for
through `requires_warehouse`, `post_action` `TRANSFER_STOCK`, `requires_employee` and
`requires_vendor`, and the submit gates refuse a document that names none of the ones its type
requires. Written only at creation, they strand any draft that lacks one: the requirement cannot be
satisfied and the document can never be anything but a draft. A type may also gain one of those
flags after its drafts exist, which strands every one of them at once.

The write SHALL be gated on the `DOC_CREATE` permission code, as the payee write is, and SHALL be
scoped to the active company. Every referenced record MUST belong to the document's own company and
MUST be one that could have been chosen at creation — an active warehouse of that company, an
employee of that company, a vendor enabled for that company — so a correction can never reach
further than the creation it is correcting. A referenced id that fails any of those checks SHALL be
rejected and the document SHALL be left unchanged.

Changing `vendor_id` SHALL clear a `vendor_bank_account_id` that does not belong to the new vendor.
The payee is required to belong to the document's own vendor at submit, so a payee left behind by a
vendor change is a submit that will be refused for a reason the requester did not cause.

This SHALL NOT relax what submit requires. A document that still names none of what its type asks
for SHALL still be refused at submit.

#### Scenario: A draft missing its warehouse is given one

- **GIVEN** a `DRAFT` document whose type has `requires_warehouse` true and no `warehouse_id`
- **WHEN** its warehouse is set to an active warehouse of its own company
- **THEN** the change is accepted and the document can then be submitted

#### Scenario: A type that gains a flag does not strand its drafts

- **GIVEN** a `DRAFT` document of a type whose `requires_employee` was turned on after the draft was
  created, leaving `related_employee_id` empty
- **WHEN** its related employee is set
- **THEN** the change is accepted

#### Scenario: The selections cannot be changed under approval

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** its `warehouse_id` is changed
- **THEN** the request is rejected and the document is unchanged

#### Scenario: The selections cannot be changed after approval

- **GIVEN** a `COMPLETED` document
- **WHEN** its `related_employee_id` is changed
- **THEN** the request is rejected

#### Scenario: Returning to draft reopens the selections

- **GIVEN** a document returned to `DRAFT` by an approver
- **WHEN** its warehouse is changed and it is resubmitted
- **THEN** the change is accepted and the document routes through its approval steps again

#### Scenario: Another company's warehouse is refused

- **GIVEN** a `DRAFT` document of company A
- **WHEN** its `warehouse_id` is set to a warehouse of company B
- **THEN** the request is rejected and the document is unchanged

#### Scenario: An inactive warehouse is refused

- **GIVEN** a `DRAFT` document of a `requires_warehouse` type
- **WHEN** its `warehouse_id` is set to a warehouse that is not active
- **THEN** the request is rejected

#### Scenario: A vendor not enabled for the company is refused

- **GIVEN** a `DRAFT` document
- **WHEN** its `vendor_id` is set to a vendor that is not enabled for the active company
- **THEN** the request is rejected

#### Scenario: Changing the vendor drops a payee that no longer belongs to it

- **GIVEN** a `DRAFT` document carrying a `vendor_bank_account_id` of vendor A
- **WHEN** its `vendor_id` is changed to vendor B
- **THEN** the change is accepted and `vendor_bank_account_id` is cleared

#### Scenario: Changing the vendor keeps a payee that still belongs to it

- **GIVEN** a `DRAFT` document carrying a `vendor_bank_account_id` of vendor A
- **WHEN** a request sets `vendor_id` to vendor A again
- **THEN** the payee is left in place

#### Scenario: A correction does not satisfy the submit gate by itself

- **GIVEN** a `DRAFT` document of a `requires_warehouse` type
- **WHEN** a request clears its `warehouse_id` and the document is submitted
- **THEN** the submit is refused and no budget is reserved

#### Scenario: A caller without DOC_CREATE cannot correct a draft

- **GIVEN** a user lacking the `DOC_CREATE` permission code
- **WHEN** they change a draft's `warehouse_id`
- **THEN** the request is rejected

### Requirement: Documents Record The External Source They Came From

A document created by an external system MAY carry the source that produced it, as `document.source_type` naming the feed and `document.source_id` holding that system's own identifier for the record. The pair SHALL be optional and SHALL be supplied together — a request carrying one without the other SHALL be rejected. A document created without them SHALL behave exactly as it does today. The values SHALL be treated as opaque to this system: nothing SHALL derive them from the authentication source or infer them when they are absent.

#### Scenario: A document is created from a feed

- **WHEN** a caller creates a document supplying `source_type` and `source_id`
- **THEN** the document records both, in addition to everything a document normally records

#### Scenario: A document is created in the web app

- **WHEN** a caller creates a document supplying neither
- **THEN** the document is created as before, with both columns empty

#### Scenario: Only one of the pair is supplied

- **WHEN** a request carries `source_type` without `source_id`, or the reverse
- **THEN** the request is rejected and no document is created

### Requirement: Creating A Document Twice For One Source Yields One Document

The system SHALL hold at most one document per `(company, source_type, source_id)`. A create request naming a source that already has a document SHALL return that existing document rather than creating another, and SHALL consume no document number and write no new row. The uniqueness SHALL be enforced by the database as well as by the service, so that two requests arriving together cannot both create one. The existing document SHALL be returned unmodified: field values carried by the repeated request SHALL NOT be applied to it.

#### Scenario: A caller retries after a timeout

- **GIVEN** a document already created for `('CLAIM', 'CLM-B-8842')` in the active company
- **WHEN** the same caller sends the same create request again
- **THEN** it receives that same document, no second document exists for that source, and no document number was consumed

#### Scenario: Two retries arrive at the same time

- **WHEN** two create requests naming the same source are processed concurrently and both find no existing document
- **THEN** exactly one document exists for that source afterwards, and both callers receive it

#### Scenario: A repeated request carries different values

- **GIVEN** a document already created for a source
- **WHEN** a create request names that source but carries different field values
- **THEN** the existing document is returned with its stored values unchanged

#### Scenario: The same identifier in another company

- **GIVEN** a document for `('CLAIM', 'CLM-1')` in one company
- **WHEN** a document is created for `('CLAIM', 'CLM-1')` in a different company
- **THEN** it is created normally, because the key is scoped by company

#### Scenario: A submitted duplicate reserves budget once

- **GIVEN** a document created and submitted for a source, holding a budget reservation
- **WHEN** the create request for that source is retried
- **THEN** the existing document is returned and no further `budget_txn` row is written

### Requirement: A Document Type Declares Whether Its Expense Is Recognised At Approval

A `document_type` SHALL carry a flag declaring that its expense is recognised when the document is fully approved rather than when a payment settles. The flag SHALL default to false, so every existing type keeps its current behaviour. The flag SHALL NOT be inferred from `post_action` or from `requires_payee`: a type opts in explicitly, because both of those answer different questions and a type that happens to match them has not asked for an accrual.

A type MAY carry the flag together with `requires_payee = true`. The combination was previously rejected because both recognitions debited the same expense accounts — the accrual from the document's budget cuts, and the settlement posting from the same rows — so a type doing both would recognise its expense twice. That premise no longer holds: the settlement posting clears the payable an accrual raised instead of debiting expense again (see `gl-journal`'s `Posting on Payment Settlement`), so a purchase type that accrues recognises its expense exactly once, at approval, and its payment moves only cash and the payable.

#### Scenario: A claim type opts in

- **WHEN** a document type is configured with the flag set and `requires_payee` false
- **THEN** the configuration is accepted, and documents of that type recognise their expense at approval

#### Scenario: A purchase type opts in

- **WHEN** a document type is configured with the flag set and `requires_payee` true
- **THEN** the configuration is accepted, and documents of that type recognise their expense at approval and clear the payable when the payment settles

#### Scenario: An ordinary type is unchanged

- **GIVEN** a document type created without mentioning the flag
- **THEN** the flag is false and the type behaves exactly as it did before the flag existed

### Requirement: A Submitted Document's Contents Are Immutable

The system SHALL reject any change to a document's field values or line items once the document has left `DRAFT`, so that what an approver signed is what takes effect. The refusal SHALL carry the invalid-state code, so a caller can tell it from a malformed payload, and its message SHALL name the only supported way to change a submitted document: return it to `DRAFT`, which costs a fresh trip through every approval step.

A document returned to `DRAFT` SHALL become editable again. Attachments SHALL remain writable at any status — evidence added while a document waits for a signature does not change what the document says.

#### Scenario: Field values cannot be changed under approval

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** its field values are written
- **THEN** the request is rejected with the invalid-state code and the stored values are unchanged

#### Scenario: Lines cannot be changed after approval

- **GIVEN** a fully approved document
- **WHEN** its lines are written
- **THEN** the request is rejected and the stored lines are unchanged

#### Scenario: A draft is still editable

- **GIVEN** a document in `DRAFT`
- **WHEN** its field values and lines are written
- **THEN** both are accepted, exactly as before

#### Scenario: Returning a document makes it editable again

- **GIVEN** a document an approver returned, which is therefore back in `DRAFT`
- **WHEN** its field values are written
- **THEN** the write is accepted, and submitting it again routes through the approval chain from its first step

#### Scenario: Evidence may still be attached while waiting for a signature

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** an attachment is uploaded to it
- **THEN** the upload is accepted, because evidence does not change what was approved

### Requirement: A Choice Field Declares The Values It Accepts

Reading a document type's form SHALL, for each field that constrains its input to a fixed set of values, return that set as an array of strings alongside the field's other attributes. A field that does not constrain its input SHALL omit the key entirely rather than carry an empty or null one, so that its presence identifies a choice field without the caller inspecting the field type.

Where the stored options cannot be read as an array of strings, the field SHALL omit the key and the rest of the form SHALL be returned unchanged. A form read is how a caller learns every field on the form; one unreadable row SHALL NOT deny it the others.

#### Scenario: A choice field carries its permitted values

- **GIVEN** a form with a field constrained to a fixed set of values
- **WHEN** the form is read
- **THEN** that field carries those values as an array of strings

#### Scenario: A free-text field carries no set of values

- **GIVEN** a form with a field that accepts free text
- **WHEN** the form is read
- **THEN** that field has no permitted-values key at all

#### Scenario: An unreadable set does not deny the caller the rest of the form

- **GIVEN** a field whose stored options cannot be read as an array of strings
- **WHEN** the form is read
- **THEN** that field omits its permitted values and every other field is returned as normal

### Requirement: A Choice Field Accepts Only What It Offers

Writing a value to a field that declares a fixed set of permitted values SHALL be refused unless the value is one of them. The refusal SHALL name the value and the values that would have been accepted, so the caller can correct it without consulting a separate document.

The rule SHALL be derived from the field's own declared values and SHALL NOT be specialised per document type: a type that offers a different set SHALL be governed by this without any change to code.

A write carrying several values SHALL be refused in full when any one of them is not offered — no value in that write SHALL be stored — so that a caller never has to reason about which half of its request took effect.

An empty value SHALL be accepted and SHALL clear the field. Whether the field was permitted to be empty is decided when the document is submitted, not here.

Where a field's declared values cannot be read as a set of strings, that field SHALL NOT be enforced and the write SHALL proceed. One unreadable configuration row SHALL NOT stop documents being filled in.

#### Scenario: An offered value is stored

- **GIVEN** a field offering a fixed set of values
- **WHEN** one of those values is written
- **THEN** it is stored

#### Scenario: A value that was never offered is refused

- **GIVEN** a field offering a fixed set of values
- **WHEN** a value outside that set is written
- **THEN** the write is refused as a validation failure, and the message names both the rejected value and the accepted ones

#### Scenario: A refused value leaves the rest of the write unwritten

- **GIVEN** a write carrying a valid value for one field and an unoffered value for another
- **WHEN** the write is attempted
- **THEN** it is refused and neither value is stored

#### Scenario: Clearing a choice field is allowed

- **GIVEN** a field offering a fixed set of values, already carrying one of them
- **WHEN** an empty value is written to it
- **THEN** the field is cleared

#### Scenario: A free-text field is unaffected

- **GIVEN** a field that declares no fixed set of values
- **WHEN** any value is written to it
- **THEN** it is stored

#### Scenario: An unreadable set is not enforced

- **GIVEN** a field whose declared values cannot be read as a set of strings
- **WHEN** a value is written to it
- **THEN** the value is stored rather than refused

### Requirement: A Document Claiming Input VAT Names Its Tax Invoice

A document SHALL carry the supplier's invoice number and invoice date, and submit SHALL reject a
document that carries VAT, whose type recognises the expense at approval, and which does not carry
both. Input VAT is claimable against a tax invoice; a claim that cannot name one is not supportable.

The requirement SHALL apply only to the documents that claim the VAT — those whose type sets
`accrues_on_approval`, which are exactly the documents whose accrual posts input VAT and is dated by
the invoice. A requisition or an order MAY carry a tax code to estimate a purchase's cost without
naming an invoice, because no supplier invoice exists when a commitment is raised.

Both fields SHALL be optional on the document itself, because most document types are not purchases
— a leave request or a promotion has no supplier invoice, and requiring one would be a field to
invent a value for.

#### Scenario: A VAT-bearing document that accrues must name its invoice

- **GIVEN** a document whose lines carry a tax code, of a type that accrues on approval
- **WHEN** it is submitted without an invoice number or without an invoice date
- **THEN** the submit is rejected and the document stays `DRAFT`

#### Scenario: A commitment may estimate tax without an invoice

- **GIVEN** a requisition carrying a tax code, of a type that does not accrue on approval
- **WHEN** it is submitted with neither field
- **THEN** it is accepted, because no supplier invoice exists when a commitment is raised

#### Scenario: A document with no VAT needs no invoice

- **GIVEN** a document whose lines carry no tax code
- **WHEN** it is submitted with neither field
- **THEN** it is accepted

#### Scenario: The invoice details are stamped on the document

- **WHEN** a VAT-bearing document is submitted with an invoice number and date
- **THEN** both are stored on the document and readable afterwards

### Requirement: Accrual On Approval May Be Combined With Requiring A Payee

A document type SHALL be permitted to set `accrues_on_approval` and `requires_payee` together, and
the system SHALL NOT reject that combination.

The two once conflicted: both paths debited the same expense accounts, so a type carrying both
recognised its expense twice. Since the payable was introduced, the payment path clears the payable
the accrual raised instead of debiting expense again, and the combination is the correct
configuration for a disbursement — the reference configuration ships it.

#### Scenario: A disbursement type carries both flags

- **WHEN** a document type is configured with `accrues_on_approval` and `requires_payee` both true
- **THEN** it is accepted

#### Scenario: The expense is recognised once

- **GIVEN** such a type
- **WHEN** a document of it is approved and later paid
- **THEN** the expense is recognised at the approval and the payment clears the payable rather than
  debiting expense a second time

### Requirement: A Document Claiming Input VAT Recognises Its Expense At Approval

Submit SHALL reject a document whose `tax_total` is greater than zero, whose type requires a payee,
and whose type does not set `accrues_on_approval`.

Input VAT is claimable at the tax invoice, and a type that recognises its expense at payment debits
`VAT_INPUT` on the payment date instead. Allowing both leaves two documents with the same supplier
invoice date falling in different returns depending on a `document_type` flag set for an unrelated
reason, and a return computed from a ledger whose tax points disagree cannot be defended.

The rule SHALL apply only to types that are PAID — those requiring a payee. A requisition or an
order MAY carry a tax code to estimate what a purchase will cost without being the document that
claims the VAT, and no supplier invoice exists when a commitment is raised.

The refusal SHALL name the reason, so an administrator knows the fix is the type's configuration
rather than the document.

#### Scenario: A paid document claiming VAT on a cash-basis type is refused

- **GIVEN** a document carrying VAT whose type requires a payee and does not accrue on approval
- **WHEN** it is submitted
- **THEN** it is rejected naming the type's configuration, and the document stays `DRAFT`

#### Scenario: A commitment may still estimate its tax

- **GIVEN** a requisition carrying a tax code, of a type that requires no payee
- **WHEN** it is submitted
- **THEN** it is accepted — it estimates a cost and is not the document that claims the VAT

#### Scenario: A VAT-bearing document on an accruing type is accepted

- **GIVEN** a paid document on a type that accrues on approval
- **WHEN** it is submitted with its supplier invoice
- **THEN** it is accepted

#### Scenario: A document with no VAT is unaffected

- **GIVEN** a document carrying no tax code, of a type that does not accrue
- **WHEN** it is submitted
- **THEN** it is accepted

### Requirement: Withdrawing A Document Is Recorded As An Act

Withdrawing a document SHALL append a `CANCEL` row to `approval_log` naming the acting user, the
`step_no` the document had reached, the moment it happened, and an optional remark supplied with the
request. The row SHALL be written in the same database transaction as the `CANCELLED` status
transition, so a withdrawn document and the record of who withdrew it commit together or not at all.

A withdrawal from `DRAFT` SHALL be recorded with `step_no` `0` — the value `document.current_step_no`
carries until routing starts. `approval_log.step_no` is non-null, and `0` already means "no step
reached".

The row SHALL NOT carry a signature, as `REJECT` and `RETURN` do not. The withdrawal SHALL remain
restricted to the document's creator and to the `DRAFT`, `SUBMITTED` and `IN_APPROVAL` statuses, and
SHALL continue to release every budget, quota and stock hold (invariant 4, invariant 5).

Withdrawing an already-`CANCELLED` document SHALL remain a no-op: exactly one `CANCEL` row exists per
withdrawal, so a retried request does not write a second.

The system SHALL emit a `document.cancelled` event after the transaction commits, carrying the
document, the requester and the step it was withdrawn from, so notification and any later capability
can react to a withdrawal as they react to a rejection.

#### Scenario: Withdrawing a routing document records who did it

- **GIVEN** a document in `IN_APPROVAL` at step 2
- **WHEN** its creator withdraws it with the remark "raised against the wrong budget"
- **THEN** the document is `CANCELLED`, and one `approval_log` row exists with action `CANCEL`,
  the creator as actor, `step_no` 2, and that remark

#### Scenario: The record and the status are one transaction

- **GIVEN** a document in `IN_APPROVAL`
- **WHEN** it is withdrawn
- **THEN** no state exists in which the document is `CANCELLED` and its `CANCEL` row is absent

#### Scenario: A withdrawn draft is recorded at step zero

- **GIVEN** a `DRAFT` document that has never routed
- **WHEN** its creator withdraws it
- **THEN** a `CANCEL` row is written with `step_no` `0`

#### Scenario: The remark is optional

- **WHEN** a document is withdrawn with no remark
- **THEN** the `CANCEL` row is written with a null remark and the withdrawal succeeds

#### Scenario: No signature is stamped

- **WHEN** a document is withdrawn
- **THEN** the `CANCEL` row's `signature_id` is null

#### Scenario: Withdrawing twice writes one row

- **GIVEN** an already-`CANCELLED` document
- **WHEN** the withdrawal is requested again
- **THEN** the request succeeds, and `approval_log` still holds exactly one `CANCEL` row for it

#### Scenario: Holds are still released

- **GIVEN** a withdrawn document that held budget and quota reservations
- **WHEN** the withdrawal completes
- **THEN** every reservation is released, as it was before this act was recorded

#### Scenario: The withdrawal is announced

- **WHEN** a document is withdrawn
- **THEN** a `document.cancelled` event is emitted after commit, carrying the document, the
  requester and the step it was withdrawn from

### Requirement: The Approvers Holding A Withdrawn Document Are Told

When a document is withdrawn while `SUBMITTED` or `IN_APPROVAL`, the system SHALL notify the actors
who were eligible to act on its current step that it was withdrawn and by whom.

The eligible actors SHALL be resolved from the step the document was on, because after the status
becomes `CANCELLED` there is no current step to resolve them from and the approval inbox — which
lists documents by `IN_APPROVAL` — no longer contains the item. An approver whose worklist loses an
entry SHALL be told why rather than discovering it on a refused approval.

A withdrawal from `DRAFT` SHALL notify nobody: the document reached no approver.

Notification failure SHALL NOT roll back the withdrawal or its `approval_log` row.

#### Scenario: The pending approvers are notified

- **GIVEN** a document in `IN_APPROVAL` whose current step resolves to two eligible approvers
- **WHEN** the creator withdraws it
- **THEN** both are notified that the document was withdrawn, and by whom

#### Scenario: A withdrawn draft notifies nobody

- **GIVEN** a `DRAFT` document
- **WHEN** its creator withdraws it
- **THEN** no approval notification is produced

#### Scenario: A failed notification does not undo the withdrawal

- **GIVEN** a document being withdrawn
- **WHEN** notification fails
- **THEN** the document is `CANCELLED` and its `CANCEL` row stands

### Requirement: A Type That Reserves Budget Has A Way To Settle It

A document type whose `requires_budget` is true SHALL be configured so that its reservation can be
settled before any document of it can be raised, and a write leaving an active, raisable type
without one SHALL be rejected. A reservation can be settled when the type's own `post_action`
settles budget, or when the configured `document_type_ref` pairings lead from it to an active type
whose `post_action` does.

The rule SHALL bind when a type is mapped to a department, and thereafter whenever the type or the
pairing graph changes. A type SHALL NOT be required to satisfy it at the moment it is created: a
pairing names two existing document types, so a type that has just been created can have no edges,
and requiring one would make a type settled further along its chain impossible to configure —
refused at creation, and unreachable afterwards because the pairing that would satisfy the rule
needs the type the rule rejected. A type that is not mapped to any department cannot have a document
raised against it and therefore reserves nothing, which is what makes the later gate sufficient.

A reservation reduces the budget's available balance from the moment it is taken and is given back
only by a `RELEASE` or converted only by an `ACTUAL` (invariant 3). A type that takes one with no
configured route to either consumes the appropriation permanently while recognising nothing: the
balance says the money is gone and the ledger says it was never spent. The reservation cannot be
recovered afterwards either, because `budget_txn` is append-only (invariant 2) and the post-action
has already run.

The check SHALL walk the pairings rather than assume a direct pairing, because a settlement may be
several documents away — a requisition reaches its disbursement through an order. The walk SHALL
traverse every configured pairing regardless of its `auto_create` flag, since a pairing marked for
manual creation is still a route a settlement can arrive by, and SHALL terminate on a graph
containing a cycle.

A path SHALL count only when every type along it is active, because a type nobody can raise is not
a route. The rule SHALL bind only while the reserving type itself is active: an inactive type raises
no documents and so reserves nothing, and reactivating it SHALL re-apply the rule.

Removing a pairing or deactivating a type SHALL be rejected when doing so would leave an active
reserving type with no remaining path. The graph can be broken from either end, and the write that
breaks it is where the cause is still visible.

A rejection SHALL name the type left without a settlement, so the administrator is told which
configuration to repair rather than only that something is wrong.

#### Scenario: A reserving type with no settlement cannot be made raisable

- **GIVEN** an active type that requires budget, whose post-action does not settle budget and which
  has no pairing to a type that does
- **WHEN** it is mapped to a department
- **THEN** the mapping is rejected, naming the type left without a settlement

#### Scenario: Creating the type is not where the rule binds

- **WHEN** a type that requires budget is created with no settling post-action
- **THEN** the create succeeds, because no pairing can exist for a type that does not yet exist

#### Scenario: Settling its own reservation is enough

- **GIVEN** an active type that requires budget with a post-action that settles budget
- **WHEN** it is mapped to a department
- **THEN** the mapping succeeds

#### Scenario: A settlement several documents away is enough

- **GIVEN** an active reserving type, and pairings leading from it through an intermediate type to
  one whose post-action settles budget
- **WHEN** it is mapped to a department
- **THEN** the mapping succeeds

#### Scenario: A path through an inactive type is not a path

- **GIVEN** a reserving type whose only route to a settlement passes through an inactive type
- **WHEN** it is mapped to a department, or activated
- **THEN** the write is rejected

#### Scenario: An inactive reserving type is not held to the rule

- **WHEN** a type that requires budget and has no settlement path is updated as inactive
- **THEN** the write succeeds, and activating it later is rejected

#### Scenario: Removing the last pairing on a path is refused

- **GIVEN** an active reserving type whose only route to a settlement runs through one pairing
- **WHEN** that pairing is removed
- **THEN** the removal is rejected, naming the reserving type it would strand

#### Scenario: Deactivating the only settling type is refused

- **GIVEN** an active reserving type whose only route to a settlement ends at one settling type
- **WHEN** that settling type is deactivated
- **THEN** the update is rejected, naming the reserving type it would strand

#### Scenario: A cyclic pairing graph still terminates

- **GIVEN** pairings that form a cycle among types, none of which settles budget
- **WHEN** a reserving type in that cycle is mapped to a department
- **THEN** the mapping is rejected rather than failing to return

### Requirement: A Type That Accrues At Approval Settles Its Own Reservation

A document type that sets `accrues_on_approval` and whose `requires_budget` is true SHALL settle
that reservation through its own `post_action`, and a create or update leaving an active type in any
other state SHALL be rejected. Unlike the reachability rule above, this one SHALL bind at creation,
because it reads only the type's own flags and needs no pairing graph to decide.

Recognising the expense at approval and converting the reservation at approval are two records of
one event. The accrual reads the document's `budget_txn` ACTUAL rows to learn which expense accounts
to debit and for how much, and for a document with no vendor it reads its own rows rather than
following a reference chain. If nothing has written those rows by the time the approval completes,
the accrual has nothing to recognise, records a terminal outcome, and is never retried — so the
document is approved, its budget is committed, and its books say nothing happened.

Having a settlement somewhere further along the chain SHALL NOT satisfy this requirement, because
the timing is what matters and not the existence: a successor settles after the accrual has already
run and given up.

The requirement SHALL apply in one direction only. A type MAY settle its own reservation without
accruing — such a type recognises nothing at approval and books its expense when it is paid, which
is a coherent configuration and SHALL remain permitted.

#### Scenario: An accruing self-reserving type without its own settlement is refused

- **WHEN** an active type is configured to require budget and accrue at approval, with a post-action
  that does not settle budget
- **THEN** the write is rejected

#### Scenario: An accruing self-reserving type that settles itself is accepted

- **WHEN** such a type is configured with a post-action that settles budget
- **THEN** the write succeeds, and a document of it recognises its expense at approval

#### Scenario: A downstream settlement does not satisfy the rule

- **GIVEN** an active type that requires budget and accrues at approval, whose only settlement is a
  paired successor's post-action
- **WHEN** the type is written
- **THEN** the write is rejected, because the accrual runs before any successor exists

#### Scenario: Settling without accruing stays permitted

- **WHEN** an active type is configured to require budget with a settling post-action and without
  `accrues_on_approval`
- **THEN** the write succeeds

### Requirement: A Document Type's Flags Must Have What They Depend On

The system SHALL refuse to save an active `document_type` whose flags leave unmet a dependency on
another flag of the same row — several flags mean nothing unless another is set a particular way. Each refusal
SHALL name the flag that is missing rather than the one that is present, because the fix is far more
often to add the prerequisite than to remove what depends on it.

The rules SHALL be decided from the type's own row — no query, no reference graph, no knowledge of
who will submit — and SHALL be applied to the resulting state of a create or an update, so that
removing a prerequisite is refused as surely as never setting one. They SHALL bind only while the
type is active: an inactive type raises no documents, and activating it re-applies them.

**A type requiring a payee SHALL require a vendor.** A payee is a vendor's bank account: the
submit check refuses a payee that does not belong to the document's vendor, and the client's picker
is loaded from the vendor. Without the vendor the required field can never be filled and every
submit is refused for something the user was given no way to supply.

**A type whose post-action moves stock SHALL require a warehouse.** Stock moves out of somewhere,
and for a transfer into somewhere else. Every check that establishes those — the source, the
destination, and that the two differ — is conditional on the warehouse requirement, so without it
they are not merely inapplicable but skipped, and the movement proceeds against a warehouse that was
never named. Which post-actions move stock SHALL be taken from the declared set rather than from a
list of document-type codes (invariant 7), and SHALL include the adjustment action: an adjustment
reserves nothing but must still say which shelf it corrects.

**A type recognising its expense at approval SHALL have a source for the charge** — either its own
budget, or a vendor. The accrual reads the document's `ACTUAL` budget rows; a document naming a
vendor follows its reference chain to the ancestor that was charged, and one without reads its own.
A type that neither reserves budget nor names a vendor has neither source, so its accrual can only
ever record a terminal skip: the document is approved and its books say nothing happened.

Having a vendor SHALL be sufficient for that rule. Whether the chain actually reaches a predecessor
that reserved is a question about the configured reference pairings, not about this row, and SHALL
NOT be decided here.

#### Scenario: A payee requirement without a vendor requirement is refused

- **WHEN** an active type is saved requiring a payee but not a vendor
- **THEN** the save is rejected, naming the vendor requirement as what is missing

#### Scenario: Requiring both is accepted

- **WHEN** an active type is saved requiring both a payee and a vendor
- **THEN** the save succeeds

#### Scenario: A stock-moving type without a warehouse requirement is refused

- **WHEN** an active type is saved whose post-action issues, adjusts or transfers stock, without
  requiring a warehouse
- **THEN** the save is rejected, naming the warehouse requirement

#### Scenario: A non-stock type needs no warehouse

- **WHEN** an active type is saved with a post-action that does not move stock and no warehouse
  requirement
- **THEN** the save succeeds

#### Scenario: An accruing type with neither budget nor vendor is refused

- **WHEN** an active type is saved that recognises its expense at approval while requiring neither
  budget nor a vendor
- **THEN** the save is rejected, naming both of the sources it could have had

#### Scenario: An accruing type with its own budget is accepted

- **WHEN** an active type is saved that recognises its expense at approval and requires budget
- **THEN** the save succeeds

#### Scenario: An accruing type with a vendor is accepted

- **WHEN** an active type is saved that recognises its expense at approval and requires a vendor,
  without requiring budget of its own
- **THEN** the save succeeds, because the charge is carried by its reference chain

#### Scenario: Removing a prerequisite is refused like never having it

- **GIVEN** an active type requiring both a payee and a vendor
- **WHEN** the vendor requirement is removed
- **THEN** the update is rejected

#### Scenario: An inactive type is not held to the rules

- **WHEN** an inactive type is saved with any of these dependencies unmet
- **THEN** the save succeeds, and activating it later is rejected
