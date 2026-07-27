## ADDED Requirements

### Requirement: Recording A Settlement Clears The Payable Its Accrual Raised

The system SHALL post one balanced entry when a settlement is recorded for a document that accrued at approval: debit the `CLAIM_PAYABLE` account of the document's company for the accrued amount, and credit the account resolved from the role the settlement type names — `CASH` crediting `CASH_CLEARING`. The entry SHALL be idempotent per source, keyed distinctly from the accrual so both can exist for one document. The posting SHALL happen in the same transaction as the settlement it records: unlike the accrual, which must not disturb an approval already granted, nothing here has been granted yet, and a settlement whose ledger effect failed SHALL NOT be recorded at all.

A settlement SHALL NOT be recorded for a document that has no accrual entry, because there would be no payable to clear.

#### Scenario: A cash settlement clears the payable

- **GIVEN** a document accrued at approval for 4,500, debiting an expense account and crediting `CLAIM_PAYABLE`
- **WHEN** a `CASH` settlement is recorded for it
- **THEN** a balanced entry debits `CLAIM_PAYABLE` 4,500 and credits `CASH_CLEARING` 4,500, leaving the payable net of that claim at zero

#### Scenario: The ledger failing takes the settlement with it

- **GIVEN** a company with no account mapped to `CASH_CLEARING`
- **WHEN** a settlement is recorded
- **THEN** the request fails, and no settlement row, attachment, or journal entry exists afterwards

#### Scenario: Accrual and settlement coexist on one document

- **GIVEN** a document that has been accrued and then settled
- **WHEN** its journal entries are read
- **THEN** two entries exist for it under different source keys, and together they leave the expense recognised once and the payable cleared

#### Scenario: Settling is posted once

- **WHEN** a settlement is recorded and the posting is attempted again for the same document
- **THEN** exactly one settlement entry exists

#### Scenario: Nothing to clear

- **GIVEN** a document with no accrual entry
- **WHEN** a settlement is recorded for it
- **THEN** the request is rejected and no entry is written

#### Scenario: The budget is untouched

- **WHEN** a settlement is recorded
- **THEN** no `budget_txn` row is written — the budget settled to `ACTUAL` when the document was approved, and paying it out settles nothing further
