## MODIFIED Requirements

### Requirement: Correction Window

The system SHALL reject a correction whose `shift_date` is older than a configured per-company window of days, measured from the shift day being corrected. The window SHALL be configuration rather than a fixed constant. Configuring it SHALL be authorized by `ATTEND_CORRECTION_MANAGE`. The system SHALL additionally reject a correction whose `shift_date` falls inside a `CLOSED` attendance period, independently of the rolling window and even when the date is well within it — a closed day is not recomputed, so an approved correction over it could only take effect in silence. The rejection SHALL name the period, so the requester knows to ask for a reopen rather than to retry.

#### Scenario: A recent day may be corrected

- **GIVEN** a company window of 30 days
- **WHEN** a correction is raised for a shift day two days ago
- **THEN** it is accepted

#### Scenario: An old day may not

- **GIVEN** the same window
- **WHEN** a correction is raised for a shift day sixty days ago
- **THEN** it is rejected

#### Scenario: Configuring the window is permission-gated

- **WHEN** a request without `ATTEND_CORRECTION_MANAGE` changes the window
- **THEN** it is forbidden and nothing changes

#### Scenario: A day inside a closed period may not be corrected

- **GIVEN** a shift day three days ago that falls inside a `CLOSED` period
- **WHEN** a correction is raised for it
- **THEN** it is rejected even though the rolling window would have allowed it
- **AND** the message names the period

#### Scenario: Reopening the period makes the day correctable again

- **GIVEN** a correction rejected because its period was closed
- **WHEN** the period is reopened and the correction is raised again
- **THEN** it is accepted
