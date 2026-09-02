## MODIFIED Requirements

### Requirement: Reserve on Submit
The system SHALL reserve budget when a budget-consuming document is submitted, creating RESERVE transactions per document line grouped by `budget_id`, EXCEPT for a budget an ancestor of that document in its `ref_document_id` chain is still holding.
A reference chain (`document.ref_document_id`, e.g. `PROC → PO → DISB`) is one spend, so it SHALL
hold a budget exactly once: the chain's hold is taken by the first document in the chain to submit
against that `budget_id` and is the one settlement converts to ACTUAL. A budget is "held" by an
ancestor when that ancestor's outstanding reserve for it — `Σ RESERVE − Σ RELEASE − Σ ACTUAL` for
that `document_id` + `budget_id` — is greater than zero; a settled, released, or never-reserving
ancestor holds nothing and the submitting document SHALL take its own hold. The check SHALL run
inside the submitting transaction and SHALL lock the candidate `budget` rows before reading, in the
same order the reservation itself locks them, so a concurrent settlement cannot release between the
check and the insert.

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

#### Scenario: A chain is charged exactly once
- GIVEN a chain whose predecessor reserved 50,000 and whose successor reserved nothing
- WHEN the successor is approved and the chain is settled for an actual of 50,000
- THEN the ACTUAL is recorded against the reserving predecessor
- AND no outstanding reserve remains anywhere in the chain
- AND the budget has been reduced by 50,000, not 100,000

#### Scenario: A successor of a settled predecessor takes its own hold
- GIVEN a predecessor whose reservation has already been settled to ACTUAL and RELEASE
- WHEN a budget-controlled successor created from it is submitted
- THEN a RESERVE is written for that budget against the successor

#### Scenario: A document with no predecessor is unaffected
- GIVEN a budget-controlled document with no `ref_document_id`
- WHEN it is submitted
- THEN it reserves its budgeted lines exactly as before
