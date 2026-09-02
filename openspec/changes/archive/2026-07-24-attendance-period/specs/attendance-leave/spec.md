## MODIFIED Requirements

### Requirement: Leave Request Recorded As A Range With Half-Day Ends

The system SHALL store each leave document's request in a `leave_request` row carrying `document_id`, `quota_id`, `from_date`, `from_half`, `to_date`, `to_half`, and a computed `total_days`. `from_half` and `to_half` SHALL each be `FULL`, `AM`, or `PM`. `to_date` SHALL NOT precede `from_date`, and when both dates are equal the request SHALL NOT specify a half at one end that contradicts the other. The system SHALL derive the half applying to any covered date as: `from_half` on `from_date`, `to_half` on `to_date`, and `FULL` on every date between. Exactly one `leave_request` SHALL exist per leave document. A request SHALL be rejected when any date it covers falls inside a `CLOSED` attendance period, because a closed day is not recomputed and approving such leave could not excuse an absence the period has already reported. A request that straddles the edge of a closed period SHALL be rejected in full rather than accepted in part, since half an approved leave is not a state the record can represent.

#### Scenario: A multi-day request with half-day ends

- **WHEN** an employee requests leave from the afternoon of the 10th to the morning of the 12th
- **THEN** the row stores `from_half` `PM` and `to_half` `AM`
- **AND** the 11th resolves to `FULL`

#### Scenario: A single full day

- **WHEN** an employee requests one full day
- **THEN** `from_date` equals `to_date` and both halves are `FULL`

#### Scenario: A single half day

- **WHEN** an employee requests the morning of one date only
- **THEN** `from_date` equals `to_date` and the date resolves to `AM`

#### Scenario: A reversed range is rejected

- **WHEN** a request has a `to_date` earlier than its `from_date`
- **THEN** the request is rejected and no row is created

#### Scenario: One request per document

- **WHEN** a second `leave_request` is written for a document that already has one
- **THEN** the write is rejected

#### Scenario: Leave inside a closed period is rejected

- **WHEN** leave is raised wholly inside a `CLOSED` period
- **THEN** it is rejected and the message names the period

#### Scenario: Leave straddling a close is rejected in full

- **GIVEN** a period closed through the 25th
- **WHEN** leave is raised from the 24th to the 27th
- **THEN** the whole request is rejected, and raising the 26th to the 27th separately is accepted
