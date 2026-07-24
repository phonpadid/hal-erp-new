## MODIFIED Requirements

### Requirement: Overtime Claim Certifies Recorded Days

The system SHALL record each overtime document's claim in an `overtime_claim` row carrying `company_id`, `document_id` (unique), `employee_id`, `from_date`, `to_date`, and the summed `ot_normal_minutes`, `holiday_work_minutes`, and `ot_holiday_minutes`. `to_date` SHALL NOT precede `from_date`. The claimed minutes SHALL be summed from the `attendance_day` rows in that range and SHALL NOT be supplied by the claimant. The three kinds SHALL be summed separately and SHALL NOT be combined into a single total, because they are compensated at different rates and a total cannot be separated afterwards. A claim whose days sum to zero overtime SHALL be rejected. A claim SHALL also be rejected when any date in its range falls inside a `CLOSED` attendance period: the period has already reported that overtime as uncertified, and certifying it afterwards would change nothing a reader could see.

#### Scenario: A claim takes its hours from the projection

- **GIVEN** shift days carrying recorded overtime
- **WHEN** an overtime claim is raised over those days
- **THEN** its minutes equal the sum of those days' recorded minutes, by kind

#### Scenario: The kinds stay separate

- **GIVEN** a range containing both weekday overtime and holiday work
- **WHEN** the claim is recorded
- **THEN** each kind is carried in its own column and no total replaces them

#### Scenario: A claim over days with no overtime is rejected

- **WHEN** a claim is raised over days whose recorded overtime is zero
- **THEN** it is rejected, because there is nothing to certify

#### Scenario: A reversed range is rejected

- **WHEN** a claim has a `to_date` earlier than its `from_date`
- **THEN** it is rejected and no row is created

#### Scenario: One claim per document

- **WHEN** a second `overtime_claim` is written for a document that already has one
- **THEN** the write is rejected

#### Scenario: A claim reaching into a closed period is rejected

- **GIVEN** a period closed through the 25th
- **WHEN** a claim is raised covering the 24th to the 27th
- **THEN** it is rejected and the message names the period

#### Scenario: A claim wholly after the close is accepted

- **GIVEN** the same closed period
- **WHEN** a claim is raised covering the 26th to the 27th
- **THEN** it is accepted
