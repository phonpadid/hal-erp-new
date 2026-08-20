## ADDED Requirements

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
