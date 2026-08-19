# document-engine

## ADDED Requirements

### Requirement: A Type That Reserves Budget Has A Way To Settle It

A document type whose `requires_budget` is true SHALL be configured so that its reservation can be
settled before any document of it can be raised, and a write leaving an active, raisable type
without one SHALL be rejected. A reservation can be settled when the type's own `post_action`
settles budget, or when the configured `document_type_ref` pairings lead from it to an active type
whose `post_action` does.

The rule SHALL bind when a type is mapped to a department, and thereafter whenever the type or the
pairing graph changes. A type SHALL NOT be required to satisfy it at the moment it is created: a
pairing names two existing document types, so a type that has just been created can have no edges,
and requiring one would make a type settled further along its chain impossible to configure —
refused at creation, and unreachable afterwards because the pairing that would satisfy the rule
needs the type the rule rejected. A type that is not mapped to any department cannot have a document
raised against it and therefore reserves nothing, which is what makes the later gate sufficient.

A reservation reduces the budget's available balance from the moment it is taken and is given back
only by a `RELEASE` or converted only by an `ACTUAL` (invariant 3). A type that takes one with no
configured route to either consumes the appropriation permanently while recognising nothing: the
balance says the money is gone and the ledger says it was never spent. The reservation cannot be
recovered afterwards either, because `budget_txn` is append-only (invariant 2) and the post-action
has already run.

The check SHALL walk the pairings rather than assume a direct pairing, because a settlement may be
several documents away — a requisition reaches its disbursement through an order. The walk SHALL
traverse every configured pairing regardless of its `auto_create` flag, since a pairing marked for
manual creation is still a route a settlement can arrive by, and SHALL terminate on a graph
containing a cycle.

A path SHALL count only when every type along it is active, because a type nobody can raise is not
a route. The rule SHALL bind only while the reserving type itself is active: an inactive type raises
no documents and so reserves nothing, and reactivating it SHALL re-apply the rule.

Removing a pairing or deactivating a type SHALL be rejected when doing so would leave an active
reserving type with no remaining path. The graph can be broken from either end, and the write that
breaks it is where the cause is still visible.

A rejection SHALL name the type left without a settlement, so the administrator is told which
configuration to repair rather than only that something is wrong.

#### Scenario: A reserving type with no settlement cannot be made raisable

- **GIVEN** an active type that requires budget, whose post-action does not settle budget and which
  has no pairing to a type that does
- **WHEN** it is mapped to a department
- **THEN** the mapping is rejected, naming the type left without a settlement

#### Scenario: Creating the type is not where the rule binds

- **WHEN** a type that requires budget is created with no settling post-action
- **THEN** the create succeeds, because no pairing can exist for a type that does not yet exist

#### Scenario: Settling its own reservation is enough

- **GIVEN** an active type that requires budget with a post-action that settles budget
- **WHEN** it is mapped to a department
- **THEN** the mapping succeeds

#### Scenario: A settlement several documents away is enough

- **GIVEN** an active reserving type, and pairings leading from it through an intermediate type to
  one whose post-action settles budget
- **WHEN** it is mapped to a department
- **THEN** the mapping succeeds

#### Scenario: A path through an inactive type is not a path

- **GIVEN** a reserving type whose only route to a settlement passes through an inactive type
- **WHEN** it is mapped to a department, or activated
- **THEN** the write is rejected

#### Scenario: An inactive reserving type is not held to the rule

- **WHEN** a type that requires budget and has no settlement path is updated as inactive
- **THEN** the write succeeds, and activating it later is rejected

#### Scenario: Removing the last pairing on a path is refused

- **GIVEN** an active reserving type whose only route to a settlement runs through one pairing
- **WHEN** that pairing is removed
- **THEN** the removal is rejected, naming the reserving type it would strand

#### Scenario: Deactivating the only settling type is refused

- **GIVEN** an active reserving type whose only route to a settlement ends at one settling type
- **WHEN** that settling type is deactivated
- **THEN** the update is rejected, naming the reserving type it would strand

#### Scenario: A cyclic pairing graph still terminates

- **GIVEN** pairings that form a cycle among types, none of which settles budget
- **WHEN** a reserving type in that cycle is mapped to a department
- **THEN** the mapping is rejected rather than failing to return

### Requirement: A Type That Accrues At Approval Settles Its Own Reservation

A document type that sets `accrues_on_approval` and whose `requires_budget` is true SHALL settle
that reservation through its own `post_action`, and a create or update leaving an active type in any
other state SHALL be rejected. Unlike the reachability rule above, this one SHALL bind at creation,
because it reads only the type's own flags and needs no pairing graph to decide.

Recognising the expense at approval and converting the reservation at approval are two records of
one event. The accrual reads the document's `budget_txn` ACTUAL rows to learn which expense accounts
to debit and for how much, and for a document with no vendor it reads its own rows rather than
following a reference chain. If nothing has written those rows by the time the approval completes,
the accrual has nothing to recognise, records a terminal outcome, and is never retried — so the
document is approved, its budget is committed, and its books say nothing happened.

Having a settlement somewhere further along the chain SHALL NOT satisfy this requirement, because
the timing is what matters and not the existence: a successor settles after the accrual has already
run and given up.

The requirement SHALL apply in one direction only. A type MAY settle its own reservation without
accruing — such a type recognises nothing at approval and books its expense when it is paid, which
is a coherent configuration and SHALL remain permitted.

#### Scenario: An accruing self-reserving type without its own settlement is refused

- **WHEN** an active type is configured to require budget and accrue at approval, with a post-action
  that does not settle budget
- **THEN** the write is rejected

#### Scenario: An accruing self-reserving type that settles itself is accepted

- **WHEN** such a type is configured with a post-action that settles budget
- **THEN** the write succeeds, and a document of it recognises its expense at approval

#### Scenario: A downstream settlement does not satisfy the rule

- **GIVEN** an active type that requires budget and accrues at approval, whose only settlement is a
  paired successor's post-action
- **WHEN** the type is written
- **THEN** the write is rejected, because the accrual runs before any successor exists

#### Scenario: Settling without accruing stays permitted

- **WHEN** an active type is configured to require budget with a settling post-action and without
  `accrues_on_approval`
- **THEN** the write succeeds
