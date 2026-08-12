# purchase-tax

## ADDED Requirements

### Requirement: A Withholding Produces A Certificate

The system SHALL issue a withholding certificate for a payment that withheld tax, carrying a running
number unique per company and year, the payee, the tax code and its rate, the base the withholding
was computed on, the amount withheld, and the date of issue.

A payment SHALL be certified at most once. The number SHALL be issued under a write lock on the
company's counter, so two concurrent issues cannot take the same number.

A certificate SHALL NOT be edited after issue: the payee holds it, and a document a third party
holds is not a draft.

Issuing SHALL be authorized by a permission code distinct from recording a payment.

#### Scenario: A withholding payment can be certified

- **GIVEN** a settled payment whose `wht_amount` is above zero
- **WHEN** a certificate is issued for it
- **THEN** it carries a number, the payee, the rate, the base, the amount and an issue date

#### Scenario: A payment that withheld nothing cannot be certified

- **GIVEN** a payment whose `wht_amount` is zero
- **WHEN** a certificate is requested
- **THEN** it is refused

#### Scenario: A payment is certified once

- **GIVEN** a payment that already has a certificate
- **WHEN** another is requested for it
- **THEN** it is refused and the existing certificate stands

#### Scenario: Numbers are unique per company under concurrency

- **WHEN** two certificates are issued for the same company at the same time
- **THEN** they carry different numbers

#### Scenario: Another company's payment cannot be certified

- **WHEN** a certificate is requested for a payment of another company
- **THEN** it is refused

### Requirement: Remitting Clears The Withheld Tax From The Books

The system SHALL provide an operation that remits a set of withholding certificates, posting one
balanced entry debiting the `WHT_PAYABLE` role and crediting the `CASH_CLEARING` role for the total
of those certificates, dated the day the money left, and stamping each certificate with the
remittance so that what is still owed is readable as the certificates not yet stamped.

The amount SHALL be the sum of the certificates being remitted, NOT the balance of the payable
account: clearing by balance would discharge withholdings belonging to a period that is not being
filed.

The posting SHALL be idempotent on its remittance identity, so a retry cannot post twice. Remitting
SHALL be authorized by a permission code distinct from issuing a certificate.

#### Scenario: A remittance clears exactly what it filed

- **GIVEN** three certificates totalling a known amount
- **WHEN** they are remitted
- **THEN** one entry debits `WHT_PAYABLE` and credits `CASH_CLEARING` for that total

#### Scenario: A certificate already remitted is not remitted again

- **GIVEN** a certificate stamped with a remittance
- **WHEN** a further remittance is attempted for it
- **THEN** it is refused

#### Scenario: A retried remittance posts once

- **WHEN** the same remittance is delivered twice
- **THEN** exactly one entry exists for it

#### Scenario: What is still owed is what is not yet stamped

- **GIVEN** some certificates remitted and others not
- **WHEN** the outstanding withholding is read
- **THEN** it reports the unstamped certificates and their total
