## MODIFIED Requirements

### Requirement: Period Reads

The system SHALL provide a paged, company-scoped read of periods and a read of one period's lines with their leave rows, both authorized by `ATTEND_PERIOD_READ`. The system SHALL also provide the log of a period. The read of punches that landed inside a closed period SHALL be paged and SHALL report its total, rather than silently returning a fixed maximum — a truncated list that does not say so reads as a complete one. A read SHALL never return a period, line or log row of another company.

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

## ADDED Requirements

### Requirement: A Period Reports How Much Of Its Range Has Been Computed

The system SHALL report, for a period, how many employee-days in its range have no computed `attendance_day` row at all, and how many have a row computed before the most recent `attendance_event` that belongs to it. These SHALL be two separate figures, because they mean different things: one is work not yet done, the other is work overtaken by a later punch. The figures SHALL be derived on read from `computed_at` and the ledger, and SHALL NOT be stored. The read SHALL be authorized by `ATTEND_PERIOD_READ`.

#### Scenario: A range nobody computed

- **GIVEN** a period whose dates have no `attendance_day` rows
- **WHEN** its coverage is read
- **THEN** it reports the missing employee-days and reports no stale ones

#### Scenario: A range overtaken by a later punch

- **GIVEN** a computed day and a punch recorded after it was computed
- **WHEN** coverage is read
- **THEN** that employee-day is reported as stale rather than as missing

#### Scenario: A fully current range

- **GIVEN** a period whose every expected employee-day is computed after its last punch
- **WHEN** coverage is read
- **THEN** both figures are zero

#### Scenario: Coverage is not stored

- **WHEN** a day is recomputed
- **THEN** the period's coverage changes without anything having been written to the period

### Requirement: Closing Reports Its Coverage And Is Not Blocked By It

The system SHALL make a period's coverage available before it is closed, so that closing a range nobody computed is a decision rather than an accident. Closing SHALL NOT be refused on the grounds of incomplete coverage: a company whose employees are all exempt from attendance has a legitimately empty period, and refusing to close it would leave an honest period permanently open.

#### Scenario: Closing an uncomputed range is allowed

- **GIVEN** a period whose range was never computed
- **WHEN** an `ATTEND_PERIOD_CLOSE` user closes it
- **THEN** it closes, and its lines report zeroes

#### Scenario: The figures are available before closing

- **WHEN** a period is about to be closed
- **THEN** its missing and stale employee-day counts can be read first

#### Scenario: An empty period is closable

- **GIVEN** a company all of whose employees have attendance not required
- **WHEN** its period is closed
- **THEN** it closes without objection
