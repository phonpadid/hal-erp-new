## ADDED Requirements

### Requirement: A spec's result does not depend on the day it runs

A spec SHALL produce the same result on every calendar day, so that a red suite always means a
real defect. A spec needing a date in the future SHALL derive one that satisfies the property it
is testing — a working day of the fixture's resolved shift, when the behaviour under test only
happens on working days — rather than assuming that tomorrow is such a day. Deriving an instant
from the clock remains permitted where the behaviour under test is itself relative to now, such
as a deduplication window; the prohibition is on letting the weekday of the run decide whether an
assertion is reachable.

#### Scenario: A leave spec asks for a future working date

- **GIVEN** a fixture employee whose department `default_work_shift` works Monday to Friday
- **WHEN** a spec files a leave request for a future date to prove the advance-notice rule
- **THEN** the date it chooses is one that shift works, so `count_leave_days` charges more than
  zero and the request reaches the advance-notice check the spec is asserting

#### Scenario: The suite runs on a Saturday

- **WHEN** the backend suite is run on a day whose following day is not a working day
- **THEN** it reports the same pass or fail result as it does on any other day
