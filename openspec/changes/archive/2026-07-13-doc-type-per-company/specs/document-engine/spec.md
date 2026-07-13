## MODIFIED Requirements

### Requirement: Configurable Document Type
The system SHALL define document types in `document_type`, **each owned by one company via
`company_id`**, with `requires_budget`, `requires_quota`, `requires_item`,
`default_gl_account`, and `post_action`, so behavior is configured, not hardcoded. A type's
`code` SHALL be unique **within its company** (`(company_id, code)`), so different companies may
each own the same code (e.g. `PR`). All document-type reads and writes (list, get, create,
update) SHALL be scoped to the active company (invariant 1); a type of another company is not
listable or resolvable. `requires_item` defaults to `false`; when `true`, every line of a
document of that type MUST carry an `item_id`. `default_gl_account` is optional; when set, an
item-less line of a `requires_budget` document resolves its budget from that GL so the
requester need not pick one.

#### Scenario: A non-budget type skips budget steps
- GIVEN a document type with requires_budget=false and requires_quota=false
- WHEN a document of that type is submitted
- THEN no budget or quota transactions are created
- AND the document still enters its approval workflow

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
