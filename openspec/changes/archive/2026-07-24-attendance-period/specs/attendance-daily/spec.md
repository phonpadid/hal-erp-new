## MODIFIED Requirements

### Requirement: Recomputation

The system SHALL provide recomputation, guarded by `ATTEND_DAY_RECOMPUTE`, for a single employee and date, for an employee over a date range, and for every employee of the active company on one date. Each employee-day SHALL be computed within its own transaction with its projection row held under a pessimistic write lock, so two concurrent recomputations of the same day cannot both insert or interleave. A range or company-wide recomputation SHALL NOT be one transaction: a failure on one employee-day SHALL NOT roll back days already committed. Attendance capture SHALL NOT trigger recomputation. A date whose shift day falls inside a `CLOSED` attendance period SHALL NOT be recomputed: a single-date request for it SHALL be refused, and a range or company-wide request SHALL skip it while recomputing the dates around it. A company that has declared no periods SHALL be unaffected.

#### Scenario: Recomputing one employee-day

- **WHEN** an `ATTEND_DAY_RECOMPUTE` user recomputes one employee and date
- **THEN** that day's row is created or replaced

#### Scenario: Recomputing a company for a date

- **WHEN** an `ATTEND_DAY_RECOMPUTE` user recomputes a whole company for a date
- **THEN** a row exists for every employee of that company for that date

#### Scenario: Concurrent recomputations of one day do not conflict

- **WHEN** two recomputations of the same employee-day run concurrently
- **THEN** exactly one row exists afterwards and it is internally consistent

#### Scenario: A failure part-way through a range keeps earlier days

- **GIVEN** a range recomputation that fails on one employee-day
- **THEN** the days already committed remain, and re-running the range is safe

#### Scenario: Recomputation is permission-gated

- **WHEN** a request without `ATTEND_DAY_RECOMPUTE` attempts a recomputation
- **THEN** it is forbidden and nothing is written

#### Scenario: Recording a punch does not recompute

- **WHEN** an employee checks in
- **THEN** no `attendance_day` row is written by that request

#### Scenario: A date inside a closed period is refused

- **GIVEN** a shift date inside a `CLOSED` period
- **WHEN** a recomputation is requested for exactly that date
- **THEN** it is refused and the stored day is unchanged

#### Scenario: A range straddling a close recomputes only what is open

- **GIVEN** a range whose earlier dates fall in a closed period and whose later dates do not
- **WHEN** the range is recomputed
- **THEN** the later dates are recomputed and the closed ones are left exactly as they were

#### Scenario: A company with no periods recomputes as before

- **GIVEN** a company that has never declared a period
- **WHEN** any date is recomputed
- **THEN** it proceeds exactly as it did before periods existed
