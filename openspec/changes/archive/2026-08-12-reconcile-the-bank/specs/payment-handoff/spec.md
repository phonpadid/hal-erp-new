# payment-handoff

## ADDED Requirements

### Requirement: The Company's Bank Accounts Are Configuration

The system SHALL hold the company's own bank accounts — the bank, the account number, the currency,
and the GL account whose balance represents it — company-scoped, and SHALL gate managing them by a
permission code distinct from reading them.

A bank account SHALL name a GL `account` of the same company rather than being one: the chart of
accounts is configuration a company owns, and a bank account is a fact about the outside world.

A bank account SHALL be deactivatable rather than deleted, because payments already point at it.

#### Scenario: A bank account names its GL account

- **WHEN** a bank account is created against an account of the same company
- **THEN** it is stored with that account

#### Scenario: Another company's GL account is refused

- **WHEN** a bank account names an account of another company
- **THEN** it is rejected

#### Scenario: Managing is gated separately from reading

- **WHEN** a user without the management code creates a bank account
- **THEN** it is rejected with 403

### Requirement: A Payment Records Which Bank Account It Left From

A payment SHALL carry the company bank account the money left from. It SHALL be defaulted from the
payment's batch when the payment came from one, and SHALL be settable when a payment is recorded
singly.

It SHALL be nullable, because payments recorded before bank accounts existed have none and SHALL NOT
be given a guessed one.

#### Scenario: A batch stamps its bank account onto its payments

- **GIVEN** a payment batch naming a bank account
- **WHEN** its result is imported and payments are recorded
- **THEN** each payment carries that bank account

#### Scenario: A payment recorded singly may name one

- **WHEN** a payment is recorded outside a batch with a bank account
- **THEN** it carries it
