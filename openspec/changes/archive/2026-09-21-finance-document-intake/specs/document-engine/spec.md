## ADDED Requirements

### Requirement: The Document List Names Who Raised Each Document

The document list read SHALL carry, for every row, the name of the user who created the document
and that person's department.

The name SHALL be the creator's `employee.full_name` for their employee record in the DOCUMENT's
company, falling back to `app_user.username` when the creator has no employee record there. This
is the rule the document detail read already applies, and the two SHALL agree: a list that printed
the account name would call the same person something different on the screen a reader moves to.

The department SHALL be the one on that same employee record, and SHALL be absent exactly when the
name fell back to a username — an employee always has a department, so a row carrying a name and no
department would mean the two had drifted apart.

The employee lookup SHALL be scoped to the document's company (invariant 1): an employee record
that exists only in another company SHALL NOT name the requester.

Resolving a page SHALL NOT cost a query per row.

#### Scenario: A creator with an employee record is named by it

- **GIVEN** a document created by a user who has an employee record in the document's company
- **WHEN** the list is read
- **THEN** the row carries that employee's full name and their department

#### Scenario: A creator with no employee record falls back to the username

- **GIVEN** a document created by a user with no employee record
- **WHEN** the list is read
- **THEN** the row carries the username as the name and no department

#### Scenario: An employee record in another company does not name the requester

- **GIVEN** a company A document created by a user whose only employee record is in company B
- **WHEN** the list is read
- **THEN** the row falls back to the username rather than naming the company B employee

#### Scenario: A page costs a bounded number of queries

- **WHEN** a page of documents raised by many different people is read
- **THEN** the requester names are resolved in a bounded number of queries, not one per row

### Requirement: The Document List Carries Each Document's Intake State

The document list read SHALL carry, for every row, whether the document has been received — the
state derived from `document_intake_log` — and, when it has, who received it and when.

Each row SHALL also carry whether the READER may register receipt of it right now: the document
has been at their desk and is not already received. The client cannot derive this — reachability
is a routing fact it has no access to — so without it the screen offers a receive action on rows
the server then refuses.

This verdict SHALL be resolved only for a reader holding `DOC_INTAKE_RECEIVE`, and SHALL be false
for every row otherwise. It costs queries no other reader has any use for.

The state SHALL be derived from the log rows, never read from a column on `document`.

Resolving a page's intake state SHALL NOT cost a query per row.

#### Scenario: A received document says who received it

- **GIVEN** a document whose latest `document_intake_log` row is a `RECEIVE`
- **WHEN** the list is read
- **THEN** the row reads as received and carries the receiving user's name and the time

#### Scenario: A reversed receipt reads as not received

- **GIVEN** a document whose latest `document_intake_log` row is a `REVERSE`
- **WHEN** the list is read
- **THEN** the row reads as not received

#### Scenario: A row the route has not reached may not be received

- **GIVEN** a document whose route has never opened a step naming the reader, and on which they
  recorded no action
- **WHEN** the list is read by a holder of `DOC_INTAKE_RECEIVE`
- **THEN** that row reads as not received and as not receivable by them

#### Scenario: An already-received row may not be received again

- **WHEN** the list is read and a row reads as received
- **THEN** that row is not receivable

#### Scenario: The verdict answers for the reader asking

- **GIVEN** a document whose open step names one user and not another
- **WHEN** each reads the list
- **THEN** the row is receivable for the first and not for the second

#### Scenario: A reader who cannot receive is not charged for the verdict

- **WHEN** a reader without `DOC_INTAKE_RECEIVE` reads the list
- **THEN** every row reads as not receivable, and the reachability queries are not run

#### Scenario: A document never received carries no intake detail

- **GIVEN** a document with no `document_intake_log` rows
- **WHEN** the list is read
- **THEN** the row reads as not received and carries no receiver or time
