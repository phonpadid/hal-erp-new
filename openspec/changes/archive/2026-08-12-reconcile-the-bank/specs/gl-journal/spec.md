# gl-journal

## ADDED Requirements

### Requirement: A Payment Clears Through A Clearing Account To A Bank Account

Recording a payment SHALL credit the `CASH_CLEARING` role, as it does, and SHALL NOT be treated as
the money having left the bank. When the bank confirms that a payment settled, the system SHALL post
a second entry debiting `CASH_CLEARING` and crediting the GL account of the bank account the payment
left from, dated the day the BANK says the money moved.

The confirmation SHALL be idempotent on the payment it confirms, so a confirmation delivered twice
resolves to the entry already written.

A payment SHALL NOT be confirmed twice, and a payment that names no bank account SHALL NOT be
confirmable — there is no account to credit.

#### Scenario: Confirming a payment moves it out of the clearing account

- **GIVEN** a recorded payment crediting the clearing account
- **WHEN** the bank confirms it settled on a date
- **THEN** an entry dated that day debits the clearing account and credits the bank account's GL
  account for the same amount

#### Scenario: A payment is confirmed once

- **WHEN** the same payment is confirmed twice
- **THEN** exactly one clearing entry exists for it

#### Scenario: A payment with no bank account cannot be confirmed

- **GIVEN** a payment that names no bank account
- **WHEN** it is confirmed
- **THEN** it is refused

### Requirement: What Has Not Cleared Is Readable Per Bank Account

The system SHALL expose, per bank account and gated by `GL_VIEW`, the payments recorded against it
that the bank has not confirmed, and their total — the money the books say has left and the bank has
not moved.

The read SHALL be derived from the journal and the payment rows rather than from a stored
reconciliation record: a derived read cannot drift from the journal because it is read from it.

The system SHALL also expose the payments in flight that name NO bank account. They credited the
clearing account like any other payment and belong to no bank account's reconciliation, so without
them the clearing balance could never be explained — and every payment recorded before bank accounts
existed is in that state. Unattributed cash in flight is what a reconciliation must surface, not
hide.

What is outstanding across the bank accounts PLUS what is unattributed SHALL equal the clearing
account's balance, so the answers cannot disagree.

#### Scenario: Unconfirmed payments are listed with their total

- **WHEN** a `GL_VIEW` user reads a bank account's reconciliation
- **THEN** the payments it has not confirmed are listed with their total

#### Scenario: A confirmed payment drops off

- **WHEN** a payment is confirmed
- **THEN** it no longer appears as outstanding for its bank account

#### Scenario: Payments naming no bank account are reported, not hidden

- **GIVEN** a payment recorded with no bank account
- **WHEN** the unattributed payments are read
- **THEN** it is listed with its amount

#### Scenario: The two reads account for the whole clearing balance

- **WHEN** the reconciliation is read
- **THEN** the outstanding across bank accounts plus the unattributed equals the clearing account's
  balance
