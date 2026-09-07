## ADDED Requirements

### Requirement: A Ledger Row Is Dated By The Document When The Document States A Day

Every `budget_txn` row of a document SHALL carry as `txn_date` the day that document states its
money moved — the `RESERVE` written at submit, and the `ACTUAL` and `RELEASE` written at settlement
alike. Where a document states no day, `txn_date` SHALL be the company's day at the moment of the
write, as it is now.

`txn_date` is already defined as the day of the event. The write path forcing it to the day of the
click is what made a spend from March unreportable as March, and this requirement removes that
forcing without changing what the column means.

The day SHALL reach the ledger from the document rather than from a parameter each caller supplies:
`budget_txn` has one insert point, and a day passed separately by each call site is a day one call
site will forget to pass.

Nothing else about the sequence changes. A backdated document still reserves at submit, converts at
settlement, and releases the remainder, in that order, under the same locks.

#### Scenario: A stated day dates the reserve

- **GIVEN** a document stating 2026-03-14 as the day its money moved
- **WHEN** it is submitted
- **THEN** its `RESERVE` rows carry `txn_date` 2026-03-14, and the quarterly read counts them in Q1

#### Scenario: The settlement of a backdated document carries the same day

- **GIVEN** the document above, settled for less than it reserved
- **WHEN** the settlement is recorded
- **THEN** its `ACTUAL` and `RELEASE` rows carry `txn_date` 2026-03-14

#### Scenario: A document stating no day is dated by the clock

- **GIVEN** a document of a type that does not record something that already happened
- **WHEN** it is submitted
- **THEN** its `RESERVE` rows carry the company's day at the moment of the write

#### Scenario: The approval trail keeps the real clock

- **GIVEN** a document stating 2026-03-14, submitted and approved today
- **WHEN** its trail is read
- **THEN** `submitted_at` and `approved_at` are today, and only `txn_date` is 2026-03-14

### Requirement: A Stated Day Is Refused Outside The Year, In The Future, Or In A Closed Period

A day stated by a document SHALL be refused unless all three hold: it falls within the fiscal year
of every budget the document charges; it is not after the company's day at the moment of the write;
and it does not fall inside a closed accounting period.

The refusal SHALL happen before any `budget_txn` row is written and SHALL name which of the three
rules the day broke. The ledger is append-only: a row dated wrongly can be answered only with a
compensating entry, never corrected, so the day is checked before it is written and not after.

A day in a closed period is refused for the reason `accounting-period` already states in "A Closed
Period Refuses New Entries" — this requirement adds no new rule there, it declares that the budget
side asks the same question.

#### Scenario: A day outside the budget's fiscal year is refused

- **GIVEN** a document charging a FY2026 budget and stating 2025-12-31
- **WHEN** it is submitted
- **THEN** it is refused naming the fiscal year, and no `budget_txn` row is written

#### Scenario: A day in the future is refused

- **GIVEN** a document stating tomorrow
- **WHEN** it is submitted
- **THEN** it is refused, and no `budget_txn` row is written

#### Scenario: A day inside a closed accounting period is refused

- **GIVEN** a closed period covering March 2026 and a document stating 2026-03-14
- **WHEN** it is submitted
- **THEN** it is refused naming the closed period, and no `budget_txn` row is written

#### Scenario: A day inside an open period on the last allowed boundary is accepted

- **GIVEN** a document stating the company's day today, with no closed period covering it
- **WHEN** it is submitted
- **THEN** it is accepted

## MODIFIED Requirements

### Requirement: Reserve on Submit

The system SHALL reserve budget when a budget-consuming document is submitted, creating RESERVE transactions per document line grouped by `budget_id`, EXCEPT for a budget an ancestor of that document in its `ref_document_id` chain is still holding.
A reference chain (`document.ref_document_id`, e.g. `PROC → PO → DISB`) is one spend, so it SHALL
hold a budget exactly once: the chain's hold is taken by the first document in the chain to submit
against that `budget_id` and is the one settlement converts to ACTUAL. A budget is "held" by an
ancestor when that ancestor's outstanding reserve for it — `Σ RESERVE − Σ RELEASE − Σ ACTUAL` for
that `document_id` + `budget_id` — is greater than zero; a settled, released, or never-reserving
ancestor holds nothing and the submitting document SHALL take its own hold. The check SHALL run
inside the submitting transaction and SHALL run after the governing `budget_control_point` rows
have been locked, so a concurrent settlement cannot release between the check and the insert.
Budgets excluded by the ancestor-hold check SHALL be excluded before amounts are summed up to
their governing control points, so a chain that holds a budget once is also checked once.

The amount reserved SHALL be checked against the budget's balance as it stands at the moment of
submission, whatever day the document states. A day is a statement about when money moved, not
about how much of the budget was left back then; reconstructing a past balance to authorise a
present reservation would let two backdated documents each pass a check the budget cannot honour.

#### Scenario: Multi-line document reserves per budget
- GIVEN a document with two lines charging two different budgets
- WHEN the document is submitted
- THEN one RESERVE transaction is created against each budget
- AND each reserved amount equals that line's base-currency amount

#### Scenario: A successor does not re-reserve what its predecessor holds
- GIVEN a completed predecessor holding an outstanding RESERVE of 50,000 on a budget
- WHEN a budget-controlled successor created from it is submitted
- THEN no RESERVE is written for that budget against the successor
- AND the budget's available balance is unchanged by the successor's submission

#### Scenario: A backdated document is checked against today's balance

- **GIVEN** a budget with 10,000,000 left today and a document stating a day in March that charges
  12,000,000
- **WHEN** it is submitted
- **THEN** the over-limit policy decides the outcome on the 10,000,000 available now, not on what
  the budget held in March
