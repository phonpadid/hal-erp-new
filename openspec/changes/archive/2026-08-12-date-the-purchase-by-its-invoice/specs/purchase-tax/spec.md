# purchase-tax

## ADDED Requirements

### Requirement: Input VAT Is Recognised On The Tax Invoice Date

The approval accrual SHALL be dated the document's vendor invoice date, so that the expense, the
payable and the input VAT are recognised together on the tax point rather than on the date a
workflow completed.

When the invoice date falls in an accounting period that is already CLOSED, the accrual SHALL be
dated the approval date instead, and the entry SHALL say which date it used. A late claim is
permitted; a month that cannot be closed because a posting is stuck is not.

#### Scenario: The accrual lands on the invoice date

- **GIVEN** a VAT-bearing document whose vendor invoice date is in an open period
- **WHEN** its approval accrual posts
- **THEN** the entry is dated the invoice date

#### Scenario: A late invoice falls back to the approval date

- **GIVEN** a document whose vendor invoice date falls in a CLOSED period
- **WHEN** its approval accrual posts
- **THEN** the entry is dated the approval date and records that the invoice date was not used

#### Scenario: A document with no invoice date is unaffected

- **GIVEN** a document carrying no vendor invoice date
- **WHEN** its approval accrual posts
- **THEN** the entry is dated the approval date, as before
