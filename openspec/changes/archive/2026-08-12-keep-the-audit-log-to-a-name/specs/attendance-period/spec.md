# attendance-period

## MODIFIED Requirements

### Requirement: Period Reads

The system SHALL provide a paged, company-scoped read of periods and a read of one period's lines with their leave rows, both authorized by `ATTEND_PERIOD_READ`. The system SHALL also provide the log of a period. The read of punches that landed inside a closed period SHALL be paged and SHALL report its total, rather than silently returning a fixed maximum — a truncated list that does not say so reads as a complete one. A read SHALL never return a period, line or log row of another company.

The log read SHALL report each row's actor as an identifier and a username only. It SHALL NOT return the actor's other account fields: an audit trail needs to say who acted, and the address at which that person receives mail is not part of that answer.

#### Scenario: Listing periods

- **WHEN** an `ATTEND_PERIOD_READ` user lists periods
- **THEN** only the active company's periods are returned

#### Scenario: Reading a closed period's lines

- **WHEN** an `ATTEND_PERIOD_READ` user reads a closed period
- **THEN** its lines are returned with their leave rows

#### Scenario: Reading is permission-gated

- **WHEN** a request without `ATTEND_PERIOD_READ` reads a period
- **THEN** it is forbidden

#### Scenario: Closed-period punches are paged, not capped

- **GIVEN** more punches inside closed periods than one page holds
- **WHEN** they are read
- **THEN** a page is returned together with the total, so the reader can tell there are more

#### Scenario: The log names its actor and says nothing else about them

- **WHEN** a period's log is read
- **THEN** each row's actor carries an id and a username, and no other account field
