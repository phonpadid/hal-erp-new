## ADDED Requirements

### Requirement: Time Correction Requests A Change To The Ledger

The system SHALL record each correction document's request in a `time_correction` row carrying `company_id`, `document_id` (unique), `employee_id`, `shift_date`, a `kind` of `ADD`, `CHANGE`, or `REMOVE`, a nullable `target_event_id`, a nullable `requested_at` instant, a nullable `requested_direction`, and a reason. A `CHANGE` or `REMOVE` SHALL name a `target_event_id`; an `ADD` SHALL NOT. An `ADD` or `CHANGE` SHALL carry a `requested_at` and `requested_direction`; a `REMOVE` SHALL NOT. The target, when given, MUST be an `attendance_event` of the same employee. A correction SHALL request a change to the punch ledger and SHALL NOT set any value on `attendance_day`, which is derived.

#### Scenario: Adding a missing punch

- **WHEN** an employee requests that a forgotten check-out be added to a shift day
- **THEN** a `time_correction` of kind `ADD` is stored with the requested instant and direction, and no target

#### Scenario: Changing a wrong punch

- **WHEN** an employee requests that a punch recorded at 08:02 be treated as 09:02
- **THEN** a `time_correction` of kind `CHANGE` is stored naming that event and the requested instant

#### Scenario: Removing a punch that should not exist

- **WHEN** an employee requests that a duplicate punch be removed
- **THEN** a `time_correction` of kind `REMOVE` is stored naming that event, with no requested instant

#### Scenario: A change without a target is rejected

- **WHEN** a `CHANGE` or `REMOVE` is raised with no `target_event_id`
- **THEN** the request is rejected

#### Scenario: An add with a target is rejected

- **WHEN** an `ADD` is raised naming an existing event
- **THEN** the request is rejected, because there is nothing for it to supersede

#### Scenario: A target belonging to another employee is rejected

- **WHEN** a correction names an `attendance_event` of a different employee
- **THEN** the request is rejected

#### Scenario: One correction per document

- **WHEN** a second `time_correction` is written for a document that already has one
- **THEN** the write is rejected

### Requirement: Approval Writes The Corrective Event

The system SHALL insert the corrective `attendance_event` only when the correction document reaches full approval, and SHALL NOT insert it while the document is a draft or awaiting approval. The inserted event SHALL be stamped `source` `MANUAL` with `recorded_by` set to the approving user, and — for a `CHANGE` or `REMOVE` — `corrects_event_id` naming the target. The superseded event SHALL remain in the ledger and remain readable. No event SHALL be updated or deleted at any point.

#### Scenario: A draft correction changes nothing

- **WHEN** a correction is recorded but not approved
- **THEN** no `attendance_event` is inserted

#### Scenario: Approval inserts a corrective punch

- **WHEN** a `CHANGE` correction is approved
- **THEN** an `attendance_event` is inserted with the requested instant, `source` `MANUAL`, and `corrects_event_id` naming the original

#### Scenario: The approver is recorded, not the requester

- **WHEN** a correction is approved
- **THEN** the inserted event's `recorded_by` is the approving user, and the requester is identifiable through the document

#### Scenario: The original survives

- **GIVEN** an approved correction over an existing punch
- **WHEN** the ledger is read
- **THEN** both the original and the corrective row are present and readable

#### Scenario: Nothing is ever updated or deleted

- **WHEN** any correction is approved
- **THEN** the ledger has only gained rows

### Requirement: Superseded Events Are Excluded From A Day

The system SHALL exclude from a shift day's punch collection any `attendance_event` that another event's `corrects_event_id` names, and SHALL also exclude a corrective event of a `REMOVE` correction. Exclusion SHALL apply however long the chain of corrections is: an event named by any other event SHALL be excluded regardless of how many rows supersede it. Excluded events SHALL remain readable in the ledger.

#### Scenario: A corrected punch stops counting

- **GIVEN** a punch at 08:02 superseded by a corrective punch at 09:02
- **WHEN** the day is computed
- **THEN** the day's first punch is 09:02

#### Scenario: A removed punch counts for nothing

- **GIVEN** a duplicate punch voided by an approved `REMOVE`
- **WHEN** the day is computed
- **THEN** neither the original nor its voiding row contributes

#### Scenario: A chain of corrections resolves to the last

- **GIVEN** an event A superseded by B, and B superseded by C
- **WHEN** the day is computed
- **THEN** only C counts, because both A and B are named by another event

#### Scenario: Exclusion does not remove anything

- **WHEN** a superseded event is excluded from a computation
- **THEN** it is still present and readable in the ledger

#### Scenario: An uncorrected day is unaffected

- **GIVEN** a day none of whose events are superseded
- **WHEN** it is computed
- **THEN** the result is exactly what it was before corrections existed

### Requirement: Correction Recomputes The Day It Fixes

When a correction reaches approval the system SHALL recompute the `attendance_day` for its `shift_date`. The recomputation SHALL run after the approval has committed and SHALL NOT roll the approval back if it fails.

#### Scenario: An incomplete day becomes complete

- **GIVEN** a day marked `INCOMPLETE` because a check-out was never recorded
- **WHEN** an `ADD` correction supplying that check-out is approved
- **THEN** the day recomputes and reports worked minutes

#### Scenario: A recomputation failure does not undo the approval

- **GIVEN** a correction being approved
- **WHEN** the subsequent recomputation fails
- **THEN** the approval and its corrective event stand

### Requirement: Correction Window

The system SHALL reject a correction whose `shift_date` is older than a configured per-company window of days, measured from the shift day being corrected. The window SHALL be configuration rather than a fixed constant. Configuring it SHALL be authorized by `ATTEND_CORRECTION_MANAGE`.

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
