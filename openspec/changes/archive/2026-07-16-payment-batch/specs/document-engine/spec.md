## MODIFIED Requirements

### Requirement: Configurable Document Type
The system SHALL define document types in `document_type`, **each owned by one company via
`company_id`**, with a `category` **code** that SHALL match an active `document_category` **of the
same company**, plus `requires_budget`, `requires_quota`, `requires_item`, **`requires_payee`**,
`default_gl_account`, and
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

## ADDED Requirements

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
