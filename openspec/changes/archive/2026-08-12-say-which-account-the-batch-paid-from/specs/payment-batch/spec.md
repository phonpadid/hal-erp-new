# payment-batch

## ADDED Requirements

### Requirement: A Batch Records The Account It Paid From

A payment batch SHALL carry the company bank account it draws on, set when it is built. Importing a
batch's result SHALL stamp that account onto every payment the import records.

It SHALL be optional: a company that has not configured its bank accounts must still be able to pay,
and a batch without one SHALL behave exactly as it did before — its payments carry no bank account
and appear in the unattributed reconciliation read, which exists so that cash in flight nobody
attributed is visible rather than lost.

Batches and payments recorded before this SHALL NOT be given a derived account. A batch that
predates the column cannot say which account it drew on, and choosing the company's only one would
be a guess written as a fact about money.

#### Scenario: A batch names its account and its payments inherit it

- **GIVEN** a batch built against a bank account
- **WHEN** its result is imported and payments are recorded
- **THEN** each payment carries that bank account

#### Scenario: A batch without an account still pays

- **GIVEN** a batch built with no bank account
- **WHEN** its result is imported
- **THEN** the payments are recorded, carrying none, and appear as unattributed

#### Scenario: Another company's bank account is refused

- **WHEN** a batch is built naming a bank account of another company
- **THEN** it is rejected
