# accounting-period

## MODIFIED Requirements

### Requirement: Reopening Is Permitted, Ordered, And Audited

The system SHALL allow a `CLOSED` period to be reopened, returning its status to `OPEN`, and SHALL
require a reason. Reopening SHALL be authorized by `PERIOD_REOPEN`, which SHALL be a different
permission code from `PERIOD_CLOSE`: closing a month is routine and reopening one that has been
reported is not.

A period SHALL NOT be reopened while a later period of the same company is `CLOSED`. Reopening a
month underneath a closed one would let its figures move after the later month's comparatives were
fixed.

The system SHALL record every declare, every close and every reopen as an append-only
`accounting_period_log` row carrying the action, the acting user, the instant, and the reason. Log
rows SHALL never be updated or deleted. The period row itself is not a ledger — its status is meant
to change — and SHALL remain editable.

A declare's row SHALL be written in the same transaction that creates the period, so that no period
can exist without the record of who declared it, and SHALL carry the declared range as its reason —
the one fact about a declare worth auditing, and one the period row cannot answer for after the
fact.

Periods declared before declares were recorded SHALL NOT be given a fabricated row: their actor is
unknown, and an audit trail whose oldest entries are guesses is worse than one that begins where the
recording began.

#### Scenario: Declaring a period records who declared it

- **WHEN** a `PERIOD_MANAGE` user declares a period
- **THEN** a log row records the declare, the actor, the instant, and the declared range

#### Scenario: A period cannot exist without its declare row

- **GIVEN** a declare that fails after the period row is created
- **WHEN** the transaction resolves
- **THEN** neither the period nor its log row is present

#### Scenario: A period is reopened with a reason

- **WHEN** a `PERIOD_REOPEN` user reopens a closed period with a reason
- **THEN** its status returns to `OPEN` and a log row records the action, the actor, and the reason

#### Scenario: Reopening without a reason is rejected

- **WHEN** a reopen is attempted with no reason
- **THEN** it is rejected and the period stays closed

#### Scenario: Reopening under a closed later period is rejected

- **GIVEN** a company whose July and August are both `CLOSED`
- **WHEN** a user reopens July
- **THEN** it is rejected, because August's figures already depend on July being final

#### Scenario: Closing permission does not grant reopening

- **WHEN** a user holding `PERIOD_CLOSE` but not `PERIOD_REOPEN` reopens a period
- **THEN** it is forbidden and the period stays closed

#### Scenario: The log is append-only

- **WHEN** any code attempts to update or delete an `accounting_period_log` row
- **THEN** the attempt is rejected and the row is unchanged

#### Scenario: Reopening restores writability

- **GIVEN** a posting refused because its period was closed
- **WHEN** the period is reopened and the posting is re-queued
- **THEN** the entry is written with its original date

### Requirement: The Period Log Is Readable

The system SHALL expose a period's append-only log — every declare, close and reopen, each with its
action, the moment it happened, the actor, and the reason where one was given — gated by
`PERIOD_VIEW` and ordered oldest first.

The actor SHALL be reported as an identifier and a username only; the read SHALL NOT return the
actor's other account fields.

Reading the log SHALL be available to anyone who may see the periods themselves, and SHALL NOT
require a code that permits closing or reopening.

#### Scenario: A reopen's reason can be read back

- **GIVEN** a period that was closed and then reopened with a reason
- **WHEN** a user holding `PERIOD_VIEW` reads its log
- **THEN** the reopen entry is present with that reason, its actor and its timestamp

#### Scenario: The log is ordered oldest first

- **GIVEN** a period that was declared, closed, reopened and closed again
- **WHEN** its log is read
- **THEN** the four entries appear in the order they happened

#### Scenario: A newly declared period's log holds its declare

- **GIVEN** a period that has been declared and nothing else
- **WHEN** its log is read
- **THEN** it holds one entry, the declare, carrying the declared range

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
