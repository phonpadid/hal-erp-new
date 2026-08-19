# platform-foundation

## MODIFIED Requirements

### Requirement: A spec's result does not depend on the day it runs

A spec SHALL produce the same result on every calendar day **and at every hour of it**, so that a red suite always means a real defect.

A spec needing a date in the future SHALL derive one that satisfies the property it is testing — a working day of the fixture's resolved shift, when the behaviour under test only happens on working days — rather than assuming that tomorrow is such a day.

A fixture's date SHALL be stated absolutely, unless a rule under test measures that date against now — a rolling window, an eligibility period, an age — in which case it SHALL be derived from now, so the distance the rule measures stays fixed. An absolute date read by a rolling window is correct on the day it is written and wrong from then on, which is worse than a spec that never passed: it decays quietly, and a red line that everyone has learned to ignore is where the next real defect hides.

Where a fixture states a calendar day that a rule evaluates in a company's own timezone, it SHALL derive that day in the same timezone the rule uses. The server's UTC day is a different day for part of every day, so a fixture built from it holds only for the hours the two happen to agree.

Deriving an instant from the clock remains permitted where the behaviour under test is itself relative to now, such as a deduplication window; the prohibition is on letting the weekday, the date, or the hour of the run decide whether an assertion is reachable.

#### Scenario: A leave spec asks for a future working date

- **GIVEN** a fixture employee whose department `default_work_shift` works Monday to Friday
- **WHEN** a spec files a leave request for a future date to prove the advance-notice rule
- **THEN** the date it chooses is one that shift works, so `count_leave_days` charges more than
  zero and the request reaches the advance-notice check the spec is asserting

#### Scenario: The suite runs on a Saturday

- **WHEN** the backend suite is run on a day whose following day is not a working day
- **THEN** it reports the same pass or fail result as it does on any other day

#### Scenario: A spec asserts a refusal that a rolling window would pre-empt

- **GIVEN** a rule that refuses a date older than a rolling window, checked before the refusal a spec is asserting
- **WHEN** the spec builds the date it submits
- **THEN** it derives that date from today, so the assertion it is making is still the one reached however long after it was written the spec is run

#### Scenario: A spec builds a date a rule reads in the company's timezone

- **GIVEN** a rule that evaluates a date on the company's local day
- **WHEN** a spec builds that date
- **THEN** it derives it in the company's timezone, and the spec reports the same result at every hour of the day

#### Scenario: The suite runs before the local day and the UTC day agree

- **WHEN** the backend suite is run at an hour where the server's UTC day differs from the company's local day
- **THEN** it reports the same pass or fail result as it does at any other hour
