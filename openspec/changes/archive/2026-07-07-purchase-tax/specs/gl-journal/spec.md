## MODIFIED Requirements

### Requirement: Posting on Payment Settlement

The system SHALL post one balanced journal entry per settled document when `payment.settled`
occurs. The entry SHALL debit the expense account(s) of the budget(s) the document charged (via
`budget.account_id`) at the locked base amount, debit the `VAT_INPUT` account for the document's
input-VAT total (`document.base_tax_total`) when it is non-zero, credit the cash-clearing account
for the actual base amount, and post the FX difference (`payment.fx_delta`) to the realized FX gain
or loss account. The posting SHALL run after the payment transaction has committed and SHALL NOT
write any `budget_txn` (invariant 6 — FX goes to accounting, not the budget). Every entry SHALL
remain balanced (Σdebit = Σcredit).

#### Scenario: Settlement with no FX difference

- **GIVEN** a settled disbursement with `base_locked` = `base_actual` = 100000 charged to one
  budget whose account is an expense account, with no VAT
- **WHEN** `payment.settled` is handled
- **THEN** a balanced entry is posted: debit the expense account 100000 and credit the
  cash-clearing account 100000, with no FX or VAT line

#### Scenario: Settlement with an FX loss

- **GIVEN** a settled disbursement with `base_locked` 100000 and `base_actual` 102000
  (`fx_delta` +2000, kind LOSS), no VAT
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits the expense account 100000 and the FX-loss account 2000, and
  credits the cash-clearing account 102000 (Σdebit = Σcredit = 102000)

#### Scenario: Settlement carrying input VAT

- **GIVEN** a settled disbursement with expense net 100000 and input VAT 7000 (`base_locked` =
  `base_actual` = 107000, `base_tax_total` 7000)
- **WHEN** `payment.settled` is handled
- **THEN** the entry debits expense 100000 and VAT_INPUT 7000 and credits cash-clearing 107000
  (Σdebit = Σcredit = 107000)

#### Scenario: Posting never rolls back the payment

- **WHEN** the posting fails (e.g. a system account is not mapped)
- **THEN** the already-committed payment is unaffected, the failure is logged, and the posting
  can be retried
