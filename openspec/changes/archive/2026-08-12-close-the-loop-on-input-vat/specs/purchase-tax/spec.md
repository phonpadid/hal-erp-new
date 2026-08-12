# purchase-tax

## ADDED Requirements

### Requirement: Filing A VAT Return Clears The Period's Input VAT

The system SHALL record a VAT return for a period and post one balanced entry debiting the
`VAT_RECEIVABLE` role and crediting `VAT_INPUT` for the period's input VAT — moving the asset from
tax paid on purchases to a debt the revenue authority owes the company, which is what filing does.

The amount SHALL be the net movement on `VAT_INPUT` for the period, read from the ledger. It SHALL
NOT be the account's balance, which includes periods already filed, and SHALL NOT be summed from
documents, which would reintroduce a second source of truth for the same figure.

A period SHALL be filed at most once: a second return would credit `VAT_INPUT` twice for one claim.
The posting SHALL be idempotent on the return's identity.

Filing SHALL be authorized by a permission code distinct from reading the tax summary.

#### Scenario: Filing moves the period's input VAT to a receivable

- **GIVEN** a period whose input VAT movement is a known amount
- **WHEN** a return is filed for it
- **THEN** one entry debits `VAT_RECEIVABLE` and credits `VAT_INPUT` for that amount

#### Scenario: A period is filed once

- **WHEN** a second return is filed for a period already filed
- **THEN** it is refused naming that period

#### Scenario: A retried filing posts once

- **WHEN** the same return is delivered twice
- **THEN** exactly one entry exists for it

#### Scenario: A period with no input VAT files nothing

- **GIVEN** a period in which no input VAT was recognised
- **WHEN** a return is filed
- **THEN** it is refused, because there is nothing to claim

#### Scenario: Another company's returns are not returned

- **WHEN** the filed returns are read
- **THEN** no return of another company appears

### Requirement: What The Authority Owes Is Where This System Stops

The system SHALL NOT record the settlement of the receivable — a refund arriving, or an offset
against output VAT computed elsewhere. Both are facts about money this system does not observe: it
has no sales side and no money-in path.

The receivable SHALL remain readable so that what has been claimed and not yet received is visible,
and clearing it SHALL be a journal voucher.

#### Scenario: The receivable stands after filing

- **WHEN** a return has been filed
- **THEN** the claimed amount is carried on the receivable account until something clears it
