# accounting-period

## ADDED Requirements

### Requirement: Closing Retranslates Foreign-Currency Payables At The Closing Rate

Closing a period SHALL revalue the company's open payables whose document is denominated in a
currency other than the company's base currency, at the exchange rate in force at the period's end
date, and
SHALL post the difference between the revalued amount and the amount the payable is carried at to
`FX_GAIN` or `FX_LOSS` against `ACCOUNTS_PAYABLE`.

A liability that grows when retranslated SHALL produce a LOSS and a larger payable; one that shrinks
SHALL produce a gain and a smaller payable.

The revaluation SHALL run after the period's postings are drained — the balances are not final
before that — and before the year is closed, because the difference is profit and loss and the year
close sweeps profit and loss into retained earnings.

Payables carried in the base currency SHALL NOT be revalued, and neither `CLAIM_PAYABLE` nor
`ACCRUED_EXPENSE` SHALL be: the first is owed in the company's own money, and the second already
carries its own reversal.

#### Scenario: A rate that rose produces a loss

- **GIVEN** an unpaid payable for 1,000 of a foreign currency, raised at 34 to the unit
- **AND** a closing rate of 35 for the period's end date
- **WHEN** the period is closed
- **THEN** an entry dated the period end debits `FX_LOSS` and credits `ACCOUNTS_PAYABLE` by the
  difference

#### Scenario: A rate that fell produces a gain

- **GIVEN** the same payable and a closing rate of 33
- **WHEN** the period is closed
- **THEN** the entry debits `ACCOUNTS_PAYABLE` and credits `FX_GAIN` by the difference

#### Scenario: A base-currency payable is not revalued

- **GIVEN** an unpaid payable whose document is in the company's base currency
- **WHEN** the period is closed
- **THEN** it contributes nothing to the revaluation

#### Scenario: A paid payable is not revalued

- **GIVEN** a payable whose payment has posted
- **WHEN** the period is closed
- **THEN** it contributes nothing

#### Scenario: A period with no foreign payables posts nothing

- **WHEN** a period with no foreign-currency payables is closed
- **THEN** no revaluation entry is written

### Requirement: The Revaluation Is Reversed The Day After The Period

The revaluation and its reversal SHALL be posted in one operation, the reversal dated the day after
the period ends.

Without it the revaluation would be stranded: a payment clears a payable at the amount its accrual
raised, so the revalued share would remain in `ACCOUNTS_PAYABLE` for good and the account would
drift away from the payables it represents.

Both SHALL be keyed by the period, so re-closing a reopened period is a no-op and cannot post a
second pair.

#### Scenario: The reversal lands the day after

- **WHEN** a period is closed with a revaluation
- **THEN** a reversing entry dated the day after the period end exchanges the same two sides

#### Scenario: The payable returns to its raised amount

- **WHEN** the revaluation and its reversal have both posted
- **THEN** the payable's balance is what its accrual raised, so a later payment clears it exactly

#### Scenario: Re-closing does not revalue twice

- **GIVEN** a period that was closed, reopened and closed again
- **WHEN** the second close runs
- **THEN** exactly one revaluation and one reversal exist for it

### Requirement: A Missing Closing Rate Refuses The Close

The close SHALL be REFUSED when no exchange rate exists for a payable's currency against the base
currency as at the period's end date, naming the currency pair and the date. It SHALL NOT fall back
to the document's locked rate or to skipping the payable.

The rate used SHALL be the latest one in force at or before the period end, which is what a closing
rate is — a company does not publish one for every calendar day.

Each fallback reports a figure at a date nobody chose or understates the liability while appearing
to have revalued it. A refusal is the only outcome that leaves somebody able to act.

#### Scenario: The close names the missing pair

- **GIVEN** an open foreign-currency payable and no rate for its pair at the period end
- **WHEN** the period is closed
- **THEN** it is refused naming the currency and the date, and the period stays open

#### Scenario: Nothing is posted by a refused close

- **WHEN** a close is refused for a missing rate
- **THEN** no revaluation entry exists for that period
