# accounting-period

## ADDED Requirements

### Requirement: The Fiscal Years A Period May Be Declared Into Are Readable On The Period Code

The system SHALL expose the active company's OPEN fiscal years, gated by `PERIOD_MANAGE`, so that a
user who may declare a period can choose the year to declare it into without also holding
`FISCAL_YEAR_MANAGE`.

Closed fiscal years SHALL NOT be offered: their result has already been rolled into retained
earnings, so a period declared into one could only be refused.

This read is company-scoped and SHALL NOT mutate anything.

#### Scenario: A period manager can read the years without the organisation code

- **GIVEN** a user holding `PERIOD_MANAGE` and not `FISCAL_YEAR_MANAGE`
- **WHEN** they request the fiscal years available for a period
- **THEN** the active company's open fiscal years are returned

#### Scenario: Closed years are not offered

- **GIVEN** a company with one open and one closed fiscal year
- **WHEN** the available fiscal years are requested
- **THEN** only the open one is returned

#### Scenario: Another company's years are never returned

- **GIVEN** two companies, each with an open fiscal year
- **WHEN** a user in company A requests the available fiscal years
- **THEN** only company A's year is returned

#### Scenario: The read is refused without the period-management code

- **WHEN** a user without `PERIOD_MANAGE` requests the available fiscal years
- **THEN** it is rejected with 403

### Requirement: The Period Log Is Readable

The system SHALL expose a period's append-only log — every close and reopen, each with its action,
the moment it happened, the actor, and the reason where one was given — gated by `PERIOD_VIEW` and
ordered oldest first.

A declare is not logged: `period_action` admits `CLOSE` and `REOPEN` only, and the column is
constrained to those two.

The actor SHALL be reported as an identifier and a username only; the read SHALL NOT return the
actor's other account fields.

Reading the log SHALL be available to anyone who may see the periods themselves, and SHALL NOT
require a code that permits closing or reopening.

#### Scenario: A reopen's reason can be read back

- **GIVEN** a period that was closed and then reopened with a reason
- **WHEN** a user holding `PERIOD_VIEW` reads its log
- **THEN** the reopen entry is present with that reason, its actor and its timestamp

#### Scenario: The log is ordered oldest first

- **GIVEN** a period that was closed, reopened and closed again
- **WHEN** its log is read
- **THEN** the three entries appear in the order they happened

#### Scenario: A declared period has an empty log until something is done to it

- **GIVEN** a period that has been declared and nothing else
- **WHEN** its log is read
- **THEN** it is empty

#### Scenario: The actor is a username, not an account

- **WHEN** a log entry is read
- **THEN** the actor carries an id and a username, and no other account field

#### Scenario: Reading the log needs only the view code

- **GIVEN** a user holding `PERIOD_VIEW` and neither `PERIOD_CLOSE` nor `PERIOD_REOPEN`
- **WHEN** they read a period's log
- **THEN** it is returned

#### Scenario: Another company's period log is not readable

- **GIVEN** a period belonging to another company
- **WHEN** its log is requested
- **THEN** it is not returned
