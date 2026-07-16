## ADDED Requirements

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

## MODIFIED Requirements

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
