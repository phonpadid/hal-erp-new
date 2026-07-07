## ADDED Requirements

### Requirement: Payment-Ready Signal on Settlement

The system SHALL emit a `payment.ready` signal when a `CUT_BUDGET` document settles its reservation
to an actual on full approval, carrying the document id, vendor, base actual amount, and GL
account(s). The signal MUST NOT create any payment or ledger row beyond the existing append-only
`budget_txn` ACTUAL/RELEASE entries.

#### Scenario: Settlement emits payment-ready

- **WHEN** a `CUT_BUDGET` document settles on approval
- **THEN** a `payment.ready` signal is emitted with the document, vendor, base amount, and GL
- **AND** no new payment or ledger table is written

### Requirement: Ready-to-Pay Queue

The system SHALL expose a read-only, company-scoped, `PAYMENT_VIEW`-gated ready-to-pay queue derived
from `COMPLETED` documents whose type `post_action` is `CUT_BUDGET`, listing the document, vendor,
settled base amount (the document's base total — equal to the actual posted to the budget), and GL
account(s), so an external accounting system can pull payables. The queue SHALL be derived, not
stored, and SHALL respect company isolation.

#### Scenario: Settled disbursement appears in the queue

- **GIVEN** a settled `CUT_BUDGET` document in the active company
- **WHEN** a `PAYMENT_VIEW` user reads the ready-to-pay queue
- **THEN** the document appears with its vendor, base actual amount, and GL

#### Scenario: Queue is company-scoped

- **WHEN** the queue is read in one company
- **THEN** another company's settled documents are not listed
