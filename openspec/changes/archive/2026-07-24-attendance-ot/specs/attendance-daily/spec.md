## MODIFIED Requirements

### Requirement: Raw Overtime Split By Kind

The system SHALL compute overtime in three separate columns: `ot_normal_minutes` for time worked beyond the expected end on a working day, `holiday_work_minutes` for time worked within normal hours on a company holiday or a shift day off, and `ot_holiday_minutes` for time beyond normal hours on such a day. Overtime below the shift's `ot_min_minutes` SHALL be discarded, and the remainder SHALL be rounded DOWN to a multiple of the shift's `ot_round_minutes`. These values are raw observations: they SHALL NOT be treated as an entitlement and SHALL NOT carry any pay rate or multiplier. They become a claim only when an overtime document certifies them, and whether a day has been certified SHALL be derived by relating it to those documents — never stored on the day, which must stay reproducible from the ledger and configuration alone.

#### Scenario: Overtime below the floor is discarded

- **GIVEN** a 17:00 end with `ot_min_minutes` 30
- **WHEN** an employee leaves at 17:20
- **THEN** `ot_normal_minutes` is 0

#### Scenario: Overtime is rounded down to the configured block

- **GIVEN** a 17:00 end with `ot_min_minutes` 30 and `ot_round_minutes` 30
- **WHEN** an employee leaves at 18:25
- **THEN** `ot_normal_minutes` is 60, not 85, because rounding is downward

#### Scenario: Work on a company holiday is recorded separately

- **GIVEN** a date in `holiday_calendar`
- **WHEN** an employee works that day
- **THEN** `holiday_work_minutes` is non-zero and `ot_normal_minutes` is 0

#### Scenario: Work on a shift day off is holiday work

- **GIVEN** a weekday the employee's shift does not work
- **WHEN** the employee works it
- **THEN** the time is recorded as `holiday_work_minutes`

#### Scenario: Extended work on a holiday splits across two columns

- **GIVEN** a company holiday and an employee who works beyond the shift's normal hours
- **WHEN** the day is computed
- **THEN** normal hours are `holiday_work_minutes` and the excess is `ot_holiday_minutes`

#### Scenario: No pay rate is stored

- **WHEN** any overtime is computed
- **THEN** only minutes by kind are stored, and no multiplier or amount is recorded anywhere

#### Scenario: Recorded overtime is not yet a claim

- **GIVEN** a day carrying recorded overtime with no overtime document over it
- **WHEN** the day is read
- **THEN** its minutes are present and nothing about them is certified

#### Scenario: Certification never writes to the day

- **GIVEN** a day whose overtime is certified by an approved overtime document
- **WHEN** the day is recomputed
- **THEN** its stored values are unchanged and it carries no reference to that document
