# successor-outbox Specification

## Purpose
A transactional outbox that makes an approved document's owed successors durable. A
`CREATE_SUCCESSOR` post-action records one `PENDING` obligation per auto-create pairing
atomically with the terminal transition, and a background sweep drains the outbox outside the
approval transaction, creating each successor with `createFrom` as the source document's
requester in the pairing's configured department. Creation is guaranteed but deferred: a
successor that cannot be created never rolls back the approval, and a bounded retry turns
persistent failure into a visible, queryable `FAILED` obligation.
## Requirements
### Requirement: Successor Intent Is Recorded Atomically With the Approval

The system SHALL insert one `pending_successor` row per configured auto-create pairing, with `status` `PENDING`, inside the same transaction that marks a `CREATE_SUCCESSOR` document `COMPLETED`, so the obligation to create the successor commits atomically with the terminal transition and cannot be lost. If that transaction rolls back, no `pending_successor` row SHALL survive; if it commits, every owed successor SHALL be recorded. Recording the intent SHALL NOT create the successor document and SHALL NOT read or write `budget_txn` or `quota_usage`. Each row SHALL carry the source document, the successor `document_type`, the company, the resolved `department_id`, `attempts`, and a nullable `last_error`.

The row's `department_id` SHALL be resolved **when the obligation is recorded** — from the pairing's `successor_department_id`, or the source document's own department when that is null — and SHALL NOT be re-resolved at sweep time. The recorded obligation is therefore a complete instruction: editing a pairing after an approval SHALL NOT redirect a handoff those approvers already granted, and a retry SHALL target the same department as the first attempt.

#### Scenario: The obligation records its resolved department

- **GIVEN** a pairing whose `successor_department_id` is Procurement
- **WHEN** a source document in another department completes
- **THEN** the `pending_successor` row's `department_id` is Procurement

#### Scenario: A later pairing edit cannot redirect a recorded obligation

- **GIVEN** a `PENDING` row recorded with Procurement as its department
- **WHEN** the pairing's `successor_department_id` is changed to another department and the row is swept
- **THEN** the successor is still created in Procurement

#### Scenario: Approval records what it owes

- **GIVEN** a `CREATE_SUCCESSOR` document whose type has two `auto_create` pairings
- **WHEN** it reaches full approval
- **THEN** two `PENDING` rows are written in the same transaction that marks it `COMPLETED`, and no successor document exists yet

#### Scenario: A rolled-back approval leaves no obligation

- **WHEN** the approval transaction rolls back
- **THEN** no `pending_successor` row exists for that document

#### Scenario: Recording the intent touches no ledger

- **WHEN** a `CREATE_SUCCESSOR` document completes
- **THEN** no `budget_txn` and no `quota_usage` row is written by the outbox insert

#### Scenario: No auto_create pairing owes nothing

- **GIVEN** a `CREATE_SUCCESSOR` document whose type has no `auto_create` pairing
- **WHEN** it reaches full approval
- **THEN** no `pending_successor` row is written and the approval completes

### Requirement: A Sweep Drains the Outbox Outside the Approval Transaction

The system SHALL drain `PENDING` rows in a background sweep that runs outside the approval transaction, creating each owed successor with the existing `createFrom` and marking the row `DONE`. A failure to create a successor SHALL NOT affect the already-committed approval, so a misconfigured or unhealthy successor type can never retroactively invalidate an approval that six people granted. The sweep SHALL be triggered by the existing `approval.outcome` event when its status is `COMPLETED`, and SHALL additionally run on a timer as a backstop, so an intent survives a missed event. Each successor SHALL be created in the source document's own company; the sweep SHALL NOT create a successor across companies.

#### Scenario: The sweep creates the owed successor

- **GIVEN** a `PENDING` row for an approved `PROC`
- **WHEN** the sweep runs
- **THEN** a DRAFT `PO` referencing the `PROC` is created and the row becomes `DONE`

#### Scenario: A creation failure leaves the approval intact

- **GIVEN** a `PENDING` row whose successor type cannot be created
- **WHEN** the sweep runs
- **THEN** the source document is still `COMPLETED` and the failure is recorded on the row

#### Scenario: The timer catches a missed event

- **GIVEN** a `PENDING` row whose triggering event was never delivered
- **WHEN** the backstop timer fires
- **THEN** the row is swept and its successor is created

#### Scenario: Successors stay inside the company

- **GIVEN** a `PENDING` row in company A
- **WHEN** the sweep runs
- **THEN** the created successor belongs to company A

### Requirement: The Successor's Identity Comes From the Chain, Not the Approver

The system SHALL create each owed successor as the **source document's requester** (`created_by`), in the department named by the pairing's `successor_department_id`, or in the source document's own department when that is null. The sweep SHALL NOT attribute the successor to whoever approved the predecessor: `created_by` = last approver silently bars that approver from acting on the successor under invariant 8 (no self-approval), an outcome nobody configured. The sweep SHALL run with no ambient request identity and SHALL derive company, department, and user from the recorded obligation and its source document alone, so the successor is identical whether it was created by the event trigger, the timer backstop, or a retry.

#### Scenario: The successor belongs to the requester, not the approver

- **GIVEN** a `PROC` raised by a requester and approved by a different user
- **WHEN** the obligation is swept
- **THEN** the created `PO` has the requester as `created_by`, not the approver

#### Scenario: The approver is not barred from the successor

- **GIVEN** the `PO` above
- **WHEN** the user who gave the `PROC` its final approval acts on the `PO`'s approval step
- **THEN** they are eligible, because invariant 8 bars only the creator

#### Scenario: The successor lands in the configured department

- **GIVEN** a pairing whose `successor_department_id` is Procurement and a source document in another department
- **WHEN** the obligation is swept
- **THEN** the successor is created in Procurement, taking Procurement's form template and workflow

#### Scenario: The result does not depend on what triggered the sweep

- **GIVEN** an obligation fulfilled by the timer backstop rather than the event
- **WHEN** the successor is created
- **THEN** its company, department, and `created_by` are the same as if the event had triggered it

### Requirement: A Row Is Claimed Once and Marked Done Atomically

The system SHALL claim a `PENDING` row with `LockMode.PESSIMISTIC_WRITE` and `SKIP LOCKED` before creating its successor, so two concurrent sweepers cannot both act on one intent and a slow row does not block the rows behind it. The create and the `DONE` transition SHALL commit in one transaction, so a crash between them cannot leave a created successor with a row still `PENDING` that a later sweep would create a second time. Document numbering's own lock SHALL NOT be relied on for this: it guarantees two successors get different numbers, not that only one is created.

#### Scenario: Two sweepers create one successor

- **GIVEN** a single `PENDING` row and two sweepers running concurrently
- **WHEN** both attempt to claim it
- **THEN** exactly one successor document is created

#### Scenario: A locked row does not block the queue

- **GIVEN** two `PENDING` rows, the first claimed by a slow sweeper
- **WHEN** a second sweeper runs
- **THEN** it processes the second row rather than waiting

#### Scenario: Create and completion commit together

- **WHEN** the sweep creates a successor and marks the row `DONE`
- **THEN** both are committed in one transaction, so neither can be observed without the other

### Requirement: Attempts Are Bounded and Persistent Failure Is Visible

The system SHALL increment `attempts` and store `last_error` on each failed sweep of a row, and SHALL move the row to `FAILED` once `attempts` reaches its bound rather than retrying forever. A `FAILED` row SHALL NOT be retried automatically and SHALL remain queryable with its error, so an approval that promised a successor and did not deliver one is a reportable state rather than a log line. `FAILED` SHALL be reachable only through the bound; a single transient failure SHALL leave the row `PENDING` for the next sweep.

#### Scenario: A transient failure is retried

- **GIVEN** a `PENDING` row whose first sweep fails
- **WHEN** the sweep runs again
- **THEN** the row was left `PENDING` with `attempts` incremented and `last_error` recorded, and the retry proceeds

#### Scenario: A permanent failure stops retrying

- **GIVEN** a row that has failed up to its attempt bound
- **WHEN** the sweep runs again
- **THEN** the row is `FAILED`, is not retried, and retains its `last_error`

#### Scenario: Failed obligations are queryable

- **GIVEN** a `FAILED` row
- **WHEN** the outbox is queried for undelivered obligations
- **THEN** that row is returned with its source document, successor type, and error

### Requirement: An Already-Existing Successor Fulfils the Obligation

A sweep SHALL mark a `PENDING` `pending_successor` row `DONE` without creating another document,
and SHALL NOT count the pass as a failed attempt, when the source document already has a live
successor (status not `REJECTED`/`CANCELLED`) of the row's `successor_type_id`. The obligation is that the source document has its successor, not that the sweep
inserted it. A sweep that loses a creation race to a manual create-from SHALL record that attempt
as a transient failure, and the next sweep SHALL find the manually created successor and mark the
row `DONE`.

#### Scenario: A hand-raised successor satisfies the outbox
- **GIVEN** a `PENDING` row for `PROC → PO` and a `PO` already created from that `PROC` by hand
- **WHEN** the sweep runs
- **THEN** the row is `DONE`, `attempts` is unchanged, and exactly one `PO` references the `PROC`

#### Scenario: Losing the race is transient
- **GIVEN** a `PENDING` row whose sweep inserts concurrently with a manual create-from of the same pairing
- **WHEN** the sweep's insert loses the uniqueness race
- **THEN** the row stays `PENDING` with `attempts` incremented, and the next sweep marks it `DONE` because the manual successor exists
