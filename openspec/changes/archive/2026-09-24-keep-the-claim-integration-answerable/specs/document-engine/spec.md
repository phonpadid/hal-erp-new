# document-engine Specification (delta)

## ADDED Requirements

### Requirement: A Document Says Whether Its Money Has Left

The system SHALL answer, for one document, whether a payment has been recorded against it, reading
the `payment` row that names the document: `payment.method` as the settlement type, `payment.paid_at`
as the day it settled, and `payment.reference` as the movement's reference outside this system.

The day SHALL be rendered in the **company's** timezone (`company.timezone`), not the server's: a
transfer recorded late in the UTC day belongs to the company's own day, and the day is what a caller
repeats to the person waiting for the money.

The answer SHALL be NOT-FOUND while no `payment` names the document. That is the state of every
approved document for as long as finance takes to pay it, and it is an answer rather than a failure:
`COMPLETED` means approved, and this read is the only thing that separates approved from paid.

The read SHALL carry the same visibility gate as reading the document itself — whoever may read a
document may ask whether it was paid — and a document belonging to another company SHALL be
not-found rather than refused, so the boundary leaks neither the reference nor the fact of payment.

The read SHALL NOT return the transfer slip, the person who recorded the payment, or the internal
note. Those are the company's audit and accountability records; a date, a method and a reference are
what a caller needs in order to tell their own customer.

#### Scenario: An approved document that has not been paid answers not-found

- **WHEN** a document is `COMPLETED` and no `payment` row names it
- **THEN** the settlement read answers not-found
- **AND** that answer is the documented state "approved, not yet paid", not an error

#### Scenario: A recorded payment answers with the method, the company's day and the reference

- **GIVEN** a `payment` naming the document with `method` = `TRANSFER`, `reference` = `TXN-9001`, and `paid_at` at an instant that falls on the 8th in the company's timezone
- **WHEN** the settlement read is called
- **THEN** it answers `settlementType` = `TRANSFER`, `settledAt` = the 8th, and `reference` = `TXN-9001`

#### Scenario: A payment recorded without a reference still answers

- **GIVEN** a `payment` naming the document with no `reference`
- **WHEN** the settlement read is called
- **THEN** it answers the method and the day, and an empty reference

#### Scenario: Another company's paid document is not-found

- **GIVEN** a document in another company with a `payment` recorded against it
- **WHEN** a caller in the active company calls the settlement read for that document id
- **THEN** the answer is not-found
- **AND** no field of that company's payment is disclosed

### Requirement: A Requester Can Discover The Budgets A Line May Charge

The system SHALL offer, on the document API, the list of budgets the caller may charge a line to —
the budgets of the department the caller belongs to when their `DOC_CREATE` scope is DEPARTMENT, plus
the shared ones — carrying identity only: the budget id, its node's code, its name, its parent, and
its GL account. It SHALL carry no amount, balance or outstanding figure.

It SHALL be gated on `DOC_CREATE`, the permission that lets the caller raise the document at all, and
NOT on `BUDGET_VIEW`: naming which budget a request charges is part of making the request, and does
not entitle the caller to know what any budget is worth.

The list SHALL be reachable by an API-key request as well as an interactive one. A budget-controlled
document type refuses to submit until every line names a budget, and an account cannot choose between
the budgets that share it — only the requester can. A machine requester is still the requester, and
without this read its only options are an identifier hardcoded elsewhere or a submit that always
fails.

#### Scenario: An API-key integrator lists the budgets it may charge

- **WHEN** a request authenticated by an API key whose bound user holds `DOC_CREATE` calls the budgets read
- **THEN** the response lists that user's department's active budgets and the shared ones
- **AND** each entry carries id, code, name, parent and GL account, and no monetary figure

#### Scenario: The list does not require permission to read budget figures

- **GIVEN** a caller holding `DOC_CREATE` and not `BUDGET_VIEW`
- **WHEN** the caller calls the budgets read
- **THEN** the list is returned

#### Scenario: Budgets of another company are never listed

- **GIVEN** budgets belonging to another company
- **WHEN** a caller in the active company calls the budgets read
- **THEN** none of them appear in the list
