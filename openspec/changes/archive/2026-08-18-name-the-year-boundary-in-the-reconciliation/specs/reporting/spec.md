# reporting

## MODIFIED Requirements

### Requirement: The Difference Is Decomposed Until Nothing Is Unexplained

The report SHALL decompose each account's difference into named causes and SHALL report what remains
after them as **unexplained**. A single difference figure states that two books disagree without
giving anyone a way to act, and the decomposition is what makes the report answerable.

The causes SHALL be:

- **ledger movement from sources that consumed no budget**, grouped by the entry's `source_type` —
  a journal entry whose source has no `ACTUAL` row;
- **budget consumption capitalised into stock** — the share of a document's `ACTUAL` the posting
  engine diverted to the goods-received account instead of the budgeted expense account, taken as
  the difference between that document's `ACTUAL` on the account and the debits its entries put
  there, rather than re-derived from the stock lines;
- **budget consumption whose posting never arrived** — `ACTUAL` rows for a document with no journal
  entry at all;
- **budget consumption dated outside the year of the appropriation it drew on** — `ACTUAL` rows on
  this year's budgets whose `txn_date` falls outside the fiscal year's date range. This is the
  cutoff: money charged to one year's appropriation on a day the ledger posted into another year.
  It SHALL be reported as two signed figures — consumption dated before the year and consumption
  dated after it — because a late arrival and an early one are different facts about a cutoff and
  net to nothing when added. Each SHALL carry the documents behind it (document number, the day the
  consumption was dated, and the amount), capped and counted, because the question the figure
  provokes is which ones.

The crossing SHALL be attributed BEFORE the two per-document causes and SHALL be subtracted from
what they see. Its amount SHALL NOT also be reported as a posting that never arrived or as
consumption capitalised into stock: a document posted in another year did post, so calling its
consumption a posting that never arrived is false, and counting the same money under two causes
makes the remainder non-zero in a report whose purpose is that it reaches zero. The subtraction
SHALL be by amount rather than by document, so a document settled partly inside the year and partly
outside it contributes to each cause only what belongs to it.

The budget side of the comparison SHALL continue to be grouped by the budget's own fiscal year, and
SHALL NOT be re-bounded by `txn_date`. An appropriation belongs to the year it was voted for, and a
row that consumes it belongs to that appropriation whatever day it fell on. Bounding the budget side
by date instead would drop a crossing row from both years' reports — out of this year by the bound,
out of the next because that report reads the next year's budgets — and the reconciliation would
balance by losing the evidence.

The unexplained remainder SHALL be reported per account. A non-zero unexplained figure means a cause
this report does not model, and SHALL be presented as something to investigate rather than as a
rounding.

#### Scenario: A manual voucher on a budgeted account is explained

- **GIVEN** a posted journal voucher debiting an account that carries a budget
- **WHEN** the reconciliation is read
- **THEN** its amount appears under the `MANUAL_JV` cause and the unexplained remainder is unchanged

#### Scenario: A stock purchase is explained by its capitalisation

- **GIVEN** a document whose stock-tracked lines were charged to a budget and debited to the
  goods-received account
- **WHEN** the reconciliation is read
- **THEN** the amount appears under the capitalisation cause and the unexplained remainder is zero

#### Scenario: A reversal that did not return the budget is visible

- **GIVEN** a settled document whose posting was later reversed, with no budget adjustment raised
- **WHEN** the reconciliation is read
- **THEN** the reversal appears under the `REVERSAL` cause, and the budget still reports the amount
  as consumed

#### Scenario: A December document approved in January is explained, not unexplained

- **GIVEN** a document that reserved a 2026 budget in December and was settled in January, so its
  `ACTUAL` is dated in 2027 while the appropriation is 2026's
- **WHEN** the 2026 reconciliation is read
- **THEN** the amount appears under the outside-the-year cause with that document named, and the
  unexplained remainder is zero

#### Scenario: Early and late crossings are reported separately

- **GIVEN** an account with one crossing dated before the year and one dated after it, of equal
  amount
- **WHEN** the reconciliation is read
- **THEN** both are reported, each with its own figure, rather than netting to nothing

#### Scenario: A crossing is not also counted as a posting that never arrived

- **GIVEN** a document whose only consumption is dated after the year and which therefore has no
  journal entry inside it
- **WHEN** the reconciliation is read
- **THEN** the amount appears under the outside-the-year cause only, the posting-never-arrived
  figure is zero for it, and the unexplained remainder is zero

#### Scenario: A document settled across the boundary splits between the causes

- **GIVEN** a document that consumed 100 inside the year and 40 after it, with a posting for the
  100 and none for the 40
- **WHEN** the reconciliation is read
- **THEN** 40 appears under the outside-the-year cause and the in-year 100 is explained on its own
  terms

#### Scenario: A crossing row is not dropped from both years

- **GIVEN** consumption on a 2026 budget dated in 2027
- **WHEN** the 2026 reconciliation is read
- **THEN** the row is still counted in 2026's `consumed`, and is explained rather than removed

#### Scenario: Everything explained leaves nothing unexplained

- **GIVEN** an account whose only activity is budget-derived postings
- **WHEN** the reconciliation is read
- **THEN** its unexplained remainder is zero
