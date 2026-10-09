## ADDED Requirements

### Requirement: A Base-Currency Document Has No Rate But One

A base-currency document SHALL carry an actual exchange rate of exactly `1`, where base-currency
means a `document.currency` equal to the posting company's `company.base_currency` or null, which
means the same thing. The system SHALL
refuse any other figure wherever a rate is **stated**: attaching a transfer slip that names one,
restating a slip's rate, and recording a payment that supplies one. The refusal SHALL name the
document's currency, so the person reading it knows the figure was not merely out of range but
meaningless for this document.

The same rule SHALL hold wherever a rate is **consumed**, independently of where it came from: the
settlement that computes `payment.base_actual` from `payment.actual_rate` SHALL refuse to restate a
base-currency document at anything but `1`, including a rate adopted from a slip attached earlier.
Checking only at the moment of statement is not enough — a rate stated while the document was still
in a foreign currency survives a later correction of that currency and is consumed at settlement by
a path that asked nobody. That is the shape of the failure this requirement exists to prevent: a
LAK document whose slip said `695` restated 21,000,000 as 14,595,000,000 and booked the difference
as FX loss, with the entry balanced and every ledger check passing.

A document that genuinely carries a foreign currency is untouched: its rate is locked at submit
(invariant 6), may be restated while it can still be refused, and its FX difference at payment still
goes to accounting.

#### Scenario: A slip may not state a rate for a base-currency document

- **GIVEN** a document whose currency is the company's base currency
- **WHEN** a transfer slip is attached stating an actual rate of 695
- **THEN** the attachment is refused, naming the document's currency, and no slip is stored

#### Scenario: Restating the rate of a base-currency document is refused

- **GIVEN** a base-currency document in approval
- **WHEN** a `PAYMENT_MANAGE` user states a rate other than 1 on it
- **THEN** the restatement is refused and `document.exchange_rate` is unchanged

#### Scenario: A rate of 1 is accepted

- **GIVEN** a base-currency document
- **WHEN** a slip states a rate of 1, or states no rate at all
- **THEN** the attachment is accepted and the payment settles with no FX difference

#### Scenario: A stale slip rate cannot be consumed at settlement

- **GIVEN** a document whose slip stated 695 while it was a foreign-currency document, and whose
  currency was afterwards corrected to the base currency
- **WHEN** its payment is recorded without naming a rate, so the slip's figure would be adopted
- **THEN** the settlement is refused rather than restating the document at 695, and no `payment`
  row and no `journal_entry` is written

#### Scenario: A foreign-currency payment is unaffected

- **GIVEN** a USD document locked at 22,000
- **WHEN** its payment is recorded at an actual rate of 22,650
- **THEN** the payment is accepted, `base_actual` is computed at 22,650, and the difference is
  booked as FX loss exactly as before
