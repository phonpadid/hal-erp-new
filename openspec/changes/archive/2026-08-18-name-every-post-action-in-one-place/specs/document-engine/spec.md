# document-engine

## ADDED Requirements

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
