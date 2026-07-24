## MODIFIED Requirements

### Requirement: Punches Are Collected By The Shift Window

The system SHALL assign an `attendance_event` to a shift day by the shift's own window rather than by the event's `local_date`. For shift day D the window SHALL run from D's expected start minus an early-arrival allowance to D's expected end plus a late-departure allowance, where the expected end MAY fall on the following calendar date for a shift whose `end_minute` exceeds 1440. An event outside every window SHALL NOT contribute to any day's worked time. The system SHALL additionally exclude any event that another event's `corrects_event_id` names, and any corrective event that voids its target without replacing it, so a corrected punch is not counted alongside the punch that corrected it. Excluded events SHALL remain in the ledger and remain readable — exclusion is a reading rule, not a deletion.

#### Scenario: A night shift is one day, not two halves

- **GIVEN** an employee on a 22:00-06:00 shift for shift day D
- **WHEN** they check in at 22:05 on D and check out at 05:58 on D+1
- **THEN** both punches belong to shift day D and the row reports a complete day

#### Scenario: A day shift is unaffected

- **GIVEN** an employee on an 08:00-17:00 shift
- **WHEN** they punch in and out on the same calendar date
- **THEN** both punches belong to that shift day

#### Scenario: An early arrival is still collected

- **GIVEN** an 08:00 shift start
- **WHEN** an employee checks in at 07:30
- **THEN** the punch belongs to that shift day and is the day's `first_in_at`

#### Scenario: A departure after overtime is still collected

- **GIVEN** a 17:00 shift end
- **WHEN** an employee checks out at 20:00
- **THEN** the punch belongs to that shift day and is the day's `last_out_at`

#### Scenario: A superseded punch does not count

- **GIVEN** a punch at 08:02 that a corrective event names in its `corrects_event_id`
- **WHEN** the day is computed
- **THEN** the 08:02 punch is excluded and the corrective one is used instead

#### Scenario: A voided punch and its voiding row both drop out

- **GIVEN** a punch voided by a corrective event that supplies no replacement time
- **WHEN** the day is computed
- **THEN** neither contributes to the day

#### Scenario: A chain of corrections leaves only the last standing

- **GIVEN** an event A named by B, and B named by C
- **WHEN** the day is computed
- **THEN** only C contributes, because an event named by any other is excluded

#### Scenario: A day with no corrections computes exactly as before

- **GIVEN** a day none of whose events are named by another
- **WHEN** it is computed
- **THEN** the result is unchanged by the existence of the exclusion rule
