## MODIFIED Requirements

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

`view_permission_code` is optional and defaults to null. When set, it SHALL name an active row of
the `permission` catalog by `code`, validated as a soft code reference on create and update — the
same rule `category` and `default_gl_account` follow, not a hard foreign key — and an unknown or
inactive code SHALL be rejected with a message naming it. An empty string SHALL be stored as null:
"no gate" has one spelling. What the gate does to reads is defined under *Document Reads Are
Narrowed To The Reader's Scope*; here it is configuration on the type, so which kinds of document a
company keeps to their owning function is data, not code (invariant 7). It SHALL be independent of
`category`, `post_action` and every other flag: a budget plan and a payroll journal are gated for
different reasons and by different codes.

The system SHALL provide, under `DOC_CONFIG_MANAGE`, a read of the active permission codes (`code`,
`name`, `module`) so the administrator configuring a type can choose the gate by name. It SHALL
return nothing but the catalog's own declarations.

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

#### Scenario: view_permission_code defaults off for existing types
- GIVEN a document type created before the gate existed
- WHEN it is read
- THEN `view_permission_code` is null and its documents are visible exactly as before

#### Scenario: A gate must name an active permission code
- WHEN a type is created or updated with `view_permission_code` that is not an active `permission`
  row
- THEN the request is rejected, naming the code

#### Scenario: An empty gate is stored as null
- WHEN a type is updated with `view_permission_code` set to an empty string
- THEN the stored value is null

#### Scenario: A document-config administrator can list the codes to choose from
- GIVEN a user holding `DOC_CONFIG_MANAGE` and not `RBAC_MANAGE`
- WHEN they read the permission-code list for the type form
- THEN the active catalog codes with their names are returned

### Requirement: Document Reads Are Narrowed To The Reader's Scope

The document list and the single-document read SHALL be filtered by the scope at which the caller
was granted `DOC_VIEW`, applied AFTER the active-company filter and before any caller-supplied
filter. OWN SHALL restrict to documents the caller created; DEPARTMENT to documents whose
`document.department_id` is any of the caller's `department_ids` — every department they hold an
active assignment in for the active company, not the home department alone; COMPANY to the whole
active company. An ungranted code SHALL collapse to OWN. A DEPARTMENT predicate whose set is empty
SHALL match nothing.

A document whose type carries a `view_permission_code` SHALL fall inside the reader's scope
visibility only if the reader holds that code in the active company, at any scope. The gate
narrows the scope half of the predicate only: it SHALL NOT hide a document the reader created, and
it SHALL NOT withdraw access the reader has by being party to the document. A type with no gate is
unaffected. The gate is a read filter: it SHALL NOT be consulted by submit, cancel, edit, the
approval actions or the approval inbox.

This narrows a default; it SHALL NOT remove access a reader has by being party to the document —
see *A Reader Never Loses The Documents They Are Party To*.

The list and the single read SHALL apply the SAME predicate. A document the list omits SHALL answer
not-found when requested by id, and a document the list shows SHALL be readable by id. A not-found
for an out-of-scope document SHALL be indistinguishable from a not-found for a document that does
not exist: reporting that a document exists but belongs to someone else is itself a disclosure.

Scope SHALL narrow reads only. Submit, cancel, edit and the approval actions SHALL keep the guards
they already have, so that narrowing what a user may READ never becomes a second, accidental
authorization rule on what they may DO.

#### Scenario: A requester at OWN scope sees only their own documents

- **GIVEN** a user granted `DOC_VIEW` at OWN scope, and documents raised by several people
- **WHEN** they list documents
- **THEN** only the documents they created are returned

#### Scenario: A department head at DEPARTMENT scope sees their department

- **GIVEN** a user granted `DOC_VIEW` at DEPARTMENT scope
- **WHEN** they list documents
- **THEN** every document of their active department in the active company is returned, and no
  document of another department

#### Scenario: A reader assigned to two departments sees both

- **GIVEN** a user granted `DOC_VIEW` at DEPARTMENT scope, assigned to department X by default and
  to department Y by a second role in the same company, and documents raised in X, Y and Z
- **WHEN** they list documents
- **THEN** the documents of X and of Y are returned and none of Z
- **AND** a document of Y requested by id is readable, and a document of Z answers not-found

#### Scenario: A second assignment's department does not leak across companies

- **GIVEN** a user assigned to department Y of company B and to department X of company A
- **WHEN** they list documents in company A
- **THEN** only documents of X are considered; Y belongs to another company and adds nothing

#### Scenario: A back-office role at COMPANY scope sees everything in the company

- **GIVEN** a user granted `DOC_VIEW` at COMPANY scope
- **WHEN** they list documents
- **THEN** every document of the active company is returned, and none from another company

#### Scenario: A document outside the reader's scope is not readable by id

- **GIVEN** a user at OWN scope and a document raised by somebody else that they have no part in
- **WHEN** they request that document by id
- **THEN** the request answers not-found

#### Scenario: Company isolation still comes first

- **GIVEN** a user granted `DOC_VIEW` at COMPANY scope in one company
- **WHEN** they list documents
- **THEN** no document of another company is returned, whatever the scope

#### Scenario: Narrowing a read does not narrow an action

- **GIVEN** a user at OWN scope who is an eligible approver on somebody else's document
- **WHEN** they approve it
- **THEN** the approval succeeds, exactly as it did before scope was applied to reads

#### Scenario: A gated type is hidden from a reader without the code

- **GIVEN** a type whose `view_permission_code` is `BUDGET_VIEW`, a document of that type in the
  reader's department, and a reader at DEPARTMENT scope who holds `DOC_VIEW` but not `BUDGET_VIEW`
- **WHEN** they list documents, and request that document by id
- **THEN** the document is not listed and the request answers not-found, while the department's
  other documents are still returned

#### Scenario: A reader holding the gate code sees the type within their scope

- **GIVEN** the same type and a reader at DEPARTMENT scope who holds `BUDGET_VIEW` at any scope
- **WHEN** they list documents
- **THEN** the gated documents of their departments are returned, and none of another department

#### Scenario: The gate never hides what the reader raised

- **GIVEN** a reader who created a document of a gated type and does not hold the gate code
- **WHEN** they list documents
- **THEN** that document is returned

#### Scenario: The gate never hides what the reader is asked to approve

- **GIVEN** a reader without the gate code who is the recorded actor on the open step of a gated
  document
- **WHEN** they list documents, and open it
- **THEN** it appears and its detail is readable

#### Scenario: A COMPANY-scope reader is gated too

- **GIVEN** a reader at COMPANY scope without the gate code
- **WHEN** they list documents
- **THEN** every ungated document of the company is returned and no gated one they did not raise
  or act on

#### Scenario: An ungated type is unaffected

- **GIVEN** a company in which no type carries a gate
- **WHEN** any reader lists documents
- **THEN** the result is exactly what scope and party membership alone would return
