# payment-recovery Specification

## Purpose
TBD - created by archiving change record-payment-mid-approval. Update Purpose after archive.

Tracks documents whose payment was recorded before the document finished approval and were
subsequently rejected by a later step, so the amount already paid out is never silently forgotten
and accounting has a queue driving them to the existing GL reversal-journal flow
(`gl-journal`, "Any Entry Can Be Reversed, Once" / `GL_JV_POST`).

## Requirements
### Requirement: Payment Recovery Flag

The system SHALL carry a nullable `recovery_status` (`PENDING_RECOVERY` or `RESOLVED`) and a
nullable `recovery_flagged_at` timestamp on `payment`. Both SHALL be null for every payment
recorded against a document that is `COMPLETED` at record time, and SHALL only ever be set when a
document whose payment was recorded early (per `payment-handoff`, "Record Payment and FX
Gain/Loss") is subsequently rejected (per `approval-workflow`, "Reject Returns and Releases"),
which SHALL set `recovery_status` to `PENDING_RECOVERY` and `recovery_flagged_at` to the moment of
that rejection, in the same transaction as the terminal status write.

Setting this flag SHALL NOT write, modify, or reverse any `budget_txn` or GL entry. The document's
reservation is released in full by the ordinary rejection path regardless of this flag; the flag
exists solely to make visible that real money already left the company for a submission the system
now shows as a clean, fully-released, never-spent reservation.

#### Scenario: A normally-recorded payment never carries a recovery flag

- **GIVEN** a document that reaches `COMPLETED` and then has its payment recorded
- **WHEN** the payment row is inspected
- **THEN** `recovery_status` and `recovery_flagged_at` are both null

#### Scenario: An early-recorded payment is flagged only if its document is later rejected

- **GIVEN** a document whose payment was recorded early at a gated step
- **WHEN** every remaining step approves it to `COMPLETED`
- **THEN** `recovery_status` remains null — being paid before the end is not itself a flagged event

#### Scenario: Rejection after an early record sets the flag

- **GIVEN** a document whose payment was recorded early at a gated step
- **WHEN** a later step rejects the document
- **THEN** the payment's `recovery_status` becomes `PENDING_RECOVERY` and `recovery_flagged_at` is
  set, in the same transaction as the document becoming `REJECTED`

### Requirement: Recovery Queue

The system SHALL expose a read-only, company-scoped, `PAYMENT_MANAGE`-gated queue of every
`payment` with `recovery_status = PENDING_RECOVERY`, listing the document, the amount and method
recorded, who it was paid to, and when it was flagged, so accounting can find every case needing a
manual reversal without searching rejected documents one by one.

#### Scenario: A flagged payment appears in the queue

- **GIVEN** a payment with `recovery_status = PENDING_RECOVERY` in the active company
- **WHEN** a `PAYMENT_MANAGE` user reads the recovery queue
- **THEN** it appears with its document, amount, method, payee, and flagged-at time

#### Scenario: The queue is company-scoped

- **WHEN** the recovery queue is read in one company
- **THEN** another company's flagged payments are not listed

#### Scenario: A resolved payment leaves the queue

- **GIVEN** a payment that was `PENDING_RECOVERY` and has since been marked `RESOLVED`
- **WHEN** the recovery queue is read
- **THEN** it is no longer listed

### Requirement: Resolving a Recovery Flag Requires a Reference to the Reversal

The system SHALL let a `PAYMENT_MANAGE` user mark a `PENDING_RECOVERY` payment `RESOLVED`, and
SHALL require a reference to the GL journal voucher that reversed the original posting as part of
that action, so the flag cannot be cleared without pointing at the accounting entry that actually
made the books right. Resolving SHALL NOT itself post, modify, or reverse any GL entry — the
reversal SHALL already have been raised and approved through the existing, unmodified "Any Entry
Can Be Reversed, Once" mechanism (`gl-journal`, `GL_JV_POST`) before it can be referenced here. A
resolve request with no reference SHALL be refused.

#### Scenario: Resolving requires a reference

- **GIVEN** a `PENDING_RECOVERY` payment
- **WHEN** a `PAYMENT_MANAGE` user marks it `RESOLVED` while supplying a reference to the reversal
  voucher
- **THEN** `recovery_status` becomes `RESOLVED` and the reference is stored

#### Scenario: Resolving without a reference is refused

- **GIVEN** a `PENDING_RECOVERY` payment
- **WHEN** a `PAYMENT_MANAGE` user attempts to mark it `RESOLVED` with no reference supplied
- **THEN** the request is refused and `recovery_status` remains `PENDING_RECOVERY`

#### Scenario: Resolving does not touch the GL

- **GIVEN** a `PENDING_RECOVERY` payment being resolved
- **WHEN** the resolve action is taken
- **THEN** no GL entry is created, modified, or reversed by that action itself
