## ADDED Requirements

### Requirement: The Type Form Offers Every Requirement Flag The Engine Enforces

The document-type form SHALL offer every flag the document engine reads at submit — `requires_budget`,
`requires_quota`, `requires_vendor`, `requires_item`, `requires_payee`, `requires_employee` and
`requires_warehouse` — and SHALL additionally offer `accrues_on_approval`, which decides when the
expense is recognised rather than what the requester must supply and is therefore presented apart
from the requirement group.

A screen that offers a subset makes the missing flags settable only by seeding the database, which is
not configuration; and it does so silently, because a shorter list of switches looks complete. This
is the same rule the post-action control already follows, applied to the flags.

Each flag SHALL carry a hint stating what it forces the requester to supply, or when the expense is
recognised, because the label alone does not convey the consequence. The client type and the
client-side schema SHALL carry every flag the create and update endpoints accept, so client and
server validation do not drift.

The document-type list SHALL show `requires_employee` and `requires_warehouse` as badges alongside the
flags it already badges, so a type's obligations are readable without opening it.

#### Scenario: Every requirement flag is offered

- **WHEN** a `DOC_CONFIG_MANAGE` user opens the document-type form
- **THEN** it offers the employee, warehouse and approval-accrual settings alongside the budget,
  quota, vendor, item and payee settings

#### Scenario: An employee-requiring type is configured without a seed

- **WHEN** a `DOC_CONFIG_MANAGE` user creates a type with `requires_employee` set and saves
- **THEN** the type is stored with that flag, and documents of that type require an employee at submit

#### Scenario: A stored flag renders when the type is edited

- **GIVEN** a document type the seed created with `requires_employee` and `accrues_on_approval` set
- **WHEN** the user opens it for editing
- **THEN** both settings render as set, rather than as absent

#### Scenario: The list distinguishes a type that names a person

- **GIVEN** one type requiring an employee and one not
- **WHEN** a `DOC_CONFIG_MANAGE` user views the document-type list
- **THEN** the first is badged as requiring an employee and the second is not

### Requirement: The Type Form States The Combinations The Server Refuses

Where a chosen combination of flags is one the server refuses, the form SHALL say so inline, in the
administrator's terms, before the request is sent. It SHALL NOT refuse the save itself: the server
remains the enforcer, and a client that refuses on its own judgement is a second rule that can drift
from the first.

The combinations SHALL be those the engine already guards: a payee required without a vendor, since a
payee is a vendor's bank account and the field would have nothing to offer; and an approval accrual on
a type that requires neither budget nor vendor, since the accrual would have no charged amount to read.
Where a type both reserves its own budget and accrues at approval, the form SHALL state that its
post-action must settle that reservation.

#### Scenario: A payee without a vendor is explained before saving

- **WHEN** the user sets `requires_payee` on a type whose `requires_vendor` is unset
- **THEN** the form states that a payee is a vendor's bank account and the document could never be
  submitted
- **AND** the save is still offered, and the server's answer is what decides

#### Scenario: An accrual with nothing to read is explained

- **WHEN** the user sets `accrues_on_approval` on a type requiring neither budget nor vendor
- **THEN** the form states that the accrual would have nothing to recognise

#### Scenario: An accrual that must settle itself is explained

- **WHEN** the user sets `accrues_on_approval` on a type that requires its own budget, with a
  post-action that does not settle
- **THEN** the form states that such a type must settle its own reservation
