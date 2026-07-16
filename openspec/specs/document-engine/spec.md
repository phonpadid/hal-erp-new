# Document Engine Specification

## Purpose
Configuration-driven documents: document types with behavior flags, versioned form
templates, per-department mapping, multi-line items, attachments, and safe numbering.

## Requirements

### Requirement: Configurable Document Type
The system SHALL define document types in `document_type`, **each owned by one company via
`company_id`**, with a `category` **code** that SHALL match an active `document_category` **of the
same company**, plus `requires_budget`, `requires_quota`, `requires_item`, `default_gl_account`, and
`post_action`, so behavior is configured, not hardcoded. On create the system SHALL reject a
`category` code that is not an active category of the active company (the allowed set is data, not a
fixed enum) — the same code-reference validation `default_gl_account` uses, not a hard foreign key.
A type's `code` SHALL be unique **within its company** (`(company_id, code)`), so different companies
may each own the same code (e.g. `PR`). All document-type reads and writes (list, get, create,
update) SHALL be scoped to the active company (invariant 1); a type of another company is not
listable or resolvable. `requires_item` defaults to `false`; when `true`, every line of a document
of that type MUST carry an `item_id`. `default_gl_account` is optional; when set, an item-less line
of a `requires_budget` document resolves its budget from that GL so the requester need not pick one.

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
SHALL NOT create budget or quota holds.

#### Scenario: PO links to its PR
- GIVEN an approved PR
- WHEN a PO is created from it
- THEN the PO's `ref_document_id` points to the PR

#### Scenario: Create-from copies header and lines
- GIVEN an `APPROVED` predecessor with multiple `document_line` rows
- WHEN a user creates a successor from it
- THEN a `DRAFT` successor is created with the header fields and lines copied, and no `budget_txn` or `quota_usage` rows are written

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
(`company_id`, `predecessor_type_id`, `successor_type_id`) SHALL be unique. Reference-chain
lookups (create-from validation and `CREATE_PO` successor resolution) SHALL read these rows
scoped to the active company and MUST NOT rely on any hardcoded pairing table. The
`CREATE_PO` post-action SHALL auto-create a successor only when exactly one successor type
resolves from `document_type_ref` for the source type.

#### Scenario: Pairing requires same-company types
- GIVEN a predecessor type in company A and a successor type in company B
- WHEN an admin attempts to create a `document_type_ref` pairing between them
- THEN the request is rejected and no pairing row is written

#### Scenario: Duplicate pairing is rejected
- GIVEN a `document_type_ref` pairing PR→PO already exists in a company
- WHEN an admin attempts to create the same PR→PO pairing again in that company
- THEN the request is rejected as a duplicate

#### Scenario: CREATE_PO auto-creates only on a single successor
- GIVEN an approved PR whose type resolves to exactly one successor type (PO) via `document_type_ref`
- WHEN the `CREATE_PO` post-action runs
- THEN a DRAFT PO referencing the PR is created

#### Scenario: CREATE_PO is a no-op when successors are ambiguous or absent
- GIVEN an approved document whose type resolves to zero or more than one successor type via `document_type_ref`
- WHEN the `CREATE_PO` post-action runs
- THEN it does nothing (logged) and the approval still completes

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
When a document's type has `requires_item = true`, the system SHALL reject submit if any
document line has no `item_id`, identifying the offending line, and SHALL leave the document
DRAFT with no budget or quota reserved. A draft MAY be saved with item-less lines; the rule
is enforced at submit (mirroring the `requires_vendor` completeness gate).

#### Scenario: Item-mandatory type rejects a free-text line at submit
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with a line that has no `item_id`
- **THEN** the submit is rejected identifying the line, and the document stays DRAFT

#### Scenario: Item-mandatory type accepts lines that all carry an item
- **GIVEN** a document type with `requires_item = true`
- **WHEN** a document of that type is submitted with every line carrying an `item_id`
- **THEN** the submit is not rejected for a missing item

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

The system SHALL resolve the beneficiary of each quota reservation server-side, within the submit
transaction, before writing `quota_usage`, when a document that has `requires_quota = true` is
submitted. For a reservation whose target `quota` is entitlement-scoped (has any
`quota_entitlement` row), the system SHALL set the reservation's `employee_id` to the submitting
user's own linked `employee` in the active company — ignoring any `employee_id` supplied by the
client — so a requester can never reserve against another employee's entitlement. If the target
quota is entitlement-scoped and the submitting user has no linked employee in the active company,
the system SHALL reject the submit with a clear error and write no `quota_usage` row. For a pool
quota (no entitlements), the system SHALL reserve with no `employee_id`.

#### Scenario: Personal quota reserves against the submitter's own employee

- **GIVEN** a submitting user linked to an employee, and a `requires_quota` draft reserving from a
  personal quota
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is stamped with the submitter's own `employee_id`, regardless
  of any employee id in the request body

#### Scenario: Personal quota with no linked employee is rejected

- **GIVEN** a submitting user with no linked employee in the active company
- **WHEN** they submit a `requires_quota` draft reserving from a personal quota
- **THEN** the submit is rejected with a clear error and no `quota_usage` row is written

#### Scenario: Pool quota reserves with no employee

- **GIVEN** a `requires_quota` draft reserving from a pool quota (no entitlements)
- **WHEN** the document is submitted
- **THEN** the `quota_usage` USE row is written with a null `employee_id`
