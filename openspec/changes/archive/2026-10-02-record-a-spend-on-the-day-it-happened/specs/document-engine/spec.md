## ADDED Requirements

### Requirement: A Document Type May Record Something That Already Happened

`document_type` SHALL carry `records_past_events`, defaulting to `false`. When `true`, a document of
that type MAY state the day its money moved, in a `document` column holding that day; when `false`,
a document of that type SHALL NOT carry one and any day supplied SHALL be rejected.

The flag is on the TYPE rather than on the document because the question it answers is a
configuration question — "is this the form we use to write down what already happened?" — and
because a flag per document would let any requester turn an ordinary disbursement into a backdated
one. Every type a company uses for its daily work leaves the flag `false` and is unaffected by this
capability entirely.

A type carrying this flag SHALL be usable exactly like any other: it is routed by `workflow`,
authored through its `form_template`, and settles through its `post_action` unchanged. What it
records is dated by the person; what the system did about it is dated by the system.

#### Scenario: A type that records the past accepts a day

- **GIVEN** a document type with `records_past_events` true
- **WHEN** a document of that type is created stating 2026-03-14
- **THEN** the day is stored on the document

#### Scenario: An ordinary type refuses a day

- **GIVEN** a document type with `records_past_events` false
- **WHEN** a document of that type is created stating any day
- **THEN** the create is refused, and the document is not created

#### Scenario: The flag changes nothing else about the type

- **GIVEN** a type with `records_past_events` true and a `post_action` of `CUT_BUDGET`
- **WHEN** a document of it is submitted and approved
- **THEN** it routes, reserves and settles exactly as the same type would with the flag false

### Requirement: Stating A Past Day Requires Its Own Permission

Stating a day earlier than the company's day SHALL require the `DOC_BACKDATE` permission. A user
without it MAY create and submit documents of a type that records past events, but SHALL NOT state
a day before today, and the attempt SHALL be refused rather than silently ignored.

Raising a document and deciding which quarter its money belongs to are different acts. The first is
ordinary work; the second moves a figure between two closed-off periods of the year and is the thing
an auditor asks about, so it is granted separately from the right to raise the document at all.

The document SHALL record which day was stated, so a reader can tell an entry dated by a person from
one dated by the clock.

#### Scenario: A user without the permission cannot backdate

- **GIVEN** a user holding `DOC_CREATE` and `DOC_SUBMIT` but not `DOC_BACKDATE`
- **WHEN** they state a day before today on a type that records past events
- **THEN** the request is refused naming the missing permission

#### Scenario: A user without the permission may still use the type

- **GIVEN** the same user
- **WHEN** they create a document of that type stating no day
- **THEN** it is created, and its ledger rows are dated by the clock

#### Scenario: The stated day is visible on the document

- **GIVEN** a document backdated to 2026-03-14
- **WHEN** it is read
- **THEN** it reports that day, distinct from its `submitted_at` and `approved_at`

## MODIFIED Requirements

### Requirement: Configurable Document Type
The system SHALL define document types in `document_type`, **each owned by one company via
`company_id`**, with a `category` **code** that SHALL match an active `document_category` **of the
same company**, plus `requires_budget`, `requires_quota`, `requires_item`, **`requires_payee`**,
**`requires_warehouse`**, **`records_past_events`**, `default_gl_account`, and
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

`records_past_events` defaults to `false`; when `true`, a document of that type may state the day its
money moved, as "A Document Type May Record Something That Already Happened" describes. It SHALL be
independent of every other flag: recording something that already happened says nothing about
whether it names a vendor, an item or a payee.

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

#### Scenario: A type declares that it records the past

- GIVEN a document type created with `records_past_events` true
- WHEN it is read back
- THEN it reports the flag, and documents of it may state the day their money moved

#### Scenario: records_past_events defaults off for existing types

- GIVEN a document type created without the flag
- WHEN it is read back
- THEN `records_past_events` is false and a document of it may not state a day
