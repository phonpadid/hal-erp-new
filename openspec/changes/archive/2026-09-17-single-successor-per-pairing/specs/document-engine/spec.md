## ADDED Requirements

### Requirement: One Live Successor Per Pairing

A predecessor document SHALL have at most one **live** successor per successor document type,
where a successor is a `document` whose `ref_document_id` names the predecessor and live means its
`status` is not `REJECTED` and not `CANCELLED`. The system SHALL refuse to create a document
referencing a predecessor when a live successor of the same `document_type_id` already exists,
with a validation error naming the predecessor's `doc_no`, the existing successor's type code,
`doc_no` and `status`. The refusal SHALL apply to every creation path — manual create-from and the
`CREATE_SUCCESSOR` outbox alike. A `REJECTED` or `CANCELLED` successor SHALL NOT count, so the
predecessor MAY receive a replacement. The rule SHALL be enforced at the database by a partial
unique index on `document (ref_document_id, document_type_id)` restricted to rows whose
`ref_document_id` is not null and whose `status` is not `REJECTED` or `CANCELLED`, so that two
concurrent creations cannot both succeed; a creation that loses that race SHALL be rejected with a
conflict (409) carrying the same message shape. The check SHALL write no `budget_txn` and no
`quota_usage` row.

#### Scenario: A second PO from the same PR is refused
- **GIVEN** an `APPROVED` `PR` that already has a `DRAFT` `PO` referencing it
- **WHEN** a user attempts create-from `PR → PO` again
- **THEN** the request is rejected with a validation error naming the existing `PO`'s `doc_no`, and no `document` row is created

#### Scenario: A second DISB from the same PO is refused
- **GIVEN** a `COMPLETED` `PO` whose `DISB` is `COMPLETED`
- **WHEN** a user attempts create-from `PO → DISB` again
- **THEN** the request is rejected with a validation error naming the existing `DISB`

#### Scenario: A cancelled successor frees the slot
- **GIVEN** an `APPROVED` `PR` whose only `PO` is `CANCELLED`
- **WHEN** a user creates a `PO` from it
- **THEN** a new `DRAFT` `PO` is created referencing the `PR`

#### Scenario: A rejected successor frees the slot
- **GIVEN** an `APPROVED` `PR` whose only `PO` is `REJECTED`
- **WHEN** a user creates a `PO` from it
- **THEN** a new `DRAFT` `PO` is created referencing the `PR`

#### Scenario: A different successor type is not blocked
- **GIVEN** a predecessor type paired with two successor types A and B, and a predecessor with a live successor of type A
- **WHEN** a user creates a successor of type B from it
- **THEN** the type-B successor is created

#### Scenario: Concurrent create-froms yield exactly one successor
- **GIVEN** an `APPROVED` `PR` with no live `PO`
- **WHEN** two create-from `PR → PO` requests run concurrently
- **THEN** exactly one `PO` exists afterwards, and the other request is rejected with a conflict (409) naming it

### Requirement: Document Detail Names Its Live Successors

The single-document read SHALL include `successors`: the list of live documents whose
`ref_document_id` is this document, each with `id`, `doc_no`, the successor's document type
`code`, and `status`, resolved within the active company. `REJECTED` and `CANCELLED` successors
SHALL be omitted. A document with no live successor SHALL return an empty list.

#### Scenario: Detail lists the PO raised from a PR
- **GIVEN** an `APPROVED` `PR` with a `SUBMITTED` `PO` referencing it
- **WHEN** a `DOC_VIEW` user reads the `PR`
- **THEN** `successors` contains the `PO`'s `id`, `doc_no`, type code `PO` and status `SUBMITTED`

#### Scenario: A cancelled successor is not listed
- **GIVEN** a `PR` whose only `PO` is `CANCELLED`
- **WHEN** the `PR` is read
- **THEN** `successors` is empty
