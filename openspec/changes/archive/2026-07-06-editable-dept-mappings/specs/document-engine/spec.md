## MODIFIED Requirements

### Requirement: Per-Department Enablement
The system SHALL map which document types a department may use via `dept_doc_type`,
binding a form template and a workflow per mapping. A mapping SHALL be unique per
`(department, document_type)`; an attempt to create a second mapping for a pair that is
already mapped SHALL be rejected with a **conflict** error, not a server error.

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
