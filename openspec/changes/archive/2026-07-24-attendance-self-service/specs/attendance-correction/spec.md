## ADDED Requirements

### Requirement: Correctable Punches Are Readable By The Person They Belong To

The system SHALL provide a read of the punches a correction could name for a given employee and shift day, so a requester selects the row that was wrong rather than describing it by time. The read SHALL exclude punches that another event already supersedes, since correcting one would change nothing. The system SHALL expose it as two routes: a self-service route guarded by `ATTEND_PUNCH_SELF` that resolves the employee from the caller's account and accepts no employee identifier, and a general route guarded by `ATTEND_PUNCH_READ` that names an employee. An employee MUST be able to see their own punches in order to correct them, and MUST NOT thereby be able to see anyone else's.

#### Scenario: An employee lists their own correctable punches

- **GIVEN** a user holding `ATTEND_PUNCH_SELF` and not `ATTEND_PUNCH_READ`
- **WHEN** they list the correctable punches of their own shift day
- **THEN** that day's punches are returned

#### Scenario: The self code does not reach another employee's punches

- **GIVEN** the same user
- **WHEN** they list the correctable punches of a different employee
- **THEN** it is forbidden

#### Scenario: Reading another employee's punches needs the read code

- **GIVEN** a user holding `ATTEND_PUNCH_READ`
- **WHEN** they list the correctable punches of any employee in the company
- **THEN** that day's punches are returned

#### Scenario: A superseded punch is not offered

- **GIVEN** a punch that an approved correction already superseded
- **WHEN** the correctable punches are listed
- **THEN** the superseded punch is absent, because correcting it would change nothing

#### Scenario: A day with no punches returns nothing rather than failing

- **WHEN** the correctable punches of a day with no punches are listed
- **THEN** an empty list is returned

### Requirement: A Correction's Subject Comes From Its Document

The system SHALL resolve whose attendance a correction is about from the document — its related employee when it names one, otherwise the employee linked to the account that raised it — and SHALL NOT accept a subject in the request body. A request naming no subject and raised by an account with no linked employee SHALL be rejected. This is the rule leave already follows for the days it charges, and it exists for the same reason: a field naming the subject is a field that lets anyone holding the document-creation code raise a correction about a colleague, whose approval would insert a hand-entered punch into that colleague's ledger.

#### Scenario: Filing on somebody else's behalf

- **GIVEN** a correction document whose related employee is named
- **WHEN** the correction detail is attached
- **THEN** it is recorded against that employee

#### Scenario: Correcting your own attendance

- **GIVEN** a correction document naming no related employee
- **WHEN** the person who raised it attaches the correction detail
- **THEN** it is recorded against their own employee record

#### Scenario: A subject in the request body is not accepted

- **WHEN** a correction request carries an employee identifier
- **THEN** it does not decide whose attendance is corrected

#### Scenario: A document with no subject and no linked raiser is rejected

- **GIVEN** a document naming no related employee, raised by an account with no employee record
- **WHEN** the correction detail is attached
- **THEN** it is rejected
