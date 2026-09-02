# Attendance-Ot Specification

## Purpose
Certifying overtime that has already been worked. The daily projection records overtime as a raw
observation — somebody stayed late and nobody agreed to pay for it — and this is the agreement.

A claim's hours are summed from `attendance_day`, never stated by the claimant: the document type
carries `derives_quantity`, so the generic submit endpoint refuses it and the owning endpoint does
the summing. The three kinds stay apart to the end, because they are compensated at different rates
and a total cannot be taken apart again.

Whether a day has been claimed is answered by relating it to claims, never by a flag on the day —
the projection must stay reproducible from the ledger and configuration alone. The statutory weekly
ceiling is enforced from recorded attendance rather than modelled as a quota: it is a limit on what
an employer may ask for, identical for everyone and granted to nobody, and every minute it counts
is already in the projection.

## Requirements
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

### Requirement: Claim Status Is Derived, Never Written Onto A Day

The system SHALL determine whether a day's overtime is claimed by relating it to `overtime_claim` rows, and SHALL NOT store a claim reference, flag, or status on `attendance_day`. Recomputing a day SHALL NOT change, clear, or be affected by any claim over it.

#### Scenario: Recomputation does not disturb a claim

- **GIVEN** a day covered by an approved overtime claim
- **WHEN** that day is recomputed
- **THEN** the claim is unchanged and the day carries no claim reference

#### Scenario: A day reports as claimed by relation

- **WHEN** a caller asks whether a day's overtime is claimed
- **THEN** the answer is derived from existing claims rather than read from the day

### Requirement: Overtime May Be Claimed Once

The system SHALL reject an overtime claim whose date range overlaps an existing claim for the same employee unless that claim's document is rejected or cancelled. A claim awaiting approval SHALL block a later one over the same days, so that two approvers never decide about the same hours independently. The overlap check and the write SHALL occur within one transaction with the employee row held under a pessimistic write lock, so two concurrent claims cannot both find a clear range.

#### Scenario: The same evening cannot be claimed twice

- **GIVEN** an approved claim covering a shift day
- **WHEN** a second claim covering that day is raised
- **THEN** it is rejected

#### Scenario: A pending claim also blocks

- **GIVEN** a submitted but unapproved claim covering a shift day
- **WHEN** a second claim covering that day is raised
- **THEN** it is rejected

#### Scenario: A rejected claim releases its days

- **GIVEN** a claim over a shift day whose document was rejected
- **WHEN** a new claim covering that day is raised
- **THEN** it is accepted

#### Scenario: Concurrent overlapping claims do not both succeed

- **WHEN** two claims covering the same day for one employee are raised concurrently
- **THEN** at most one is stored

### Requirement: Statutory Weekly Ceiling Enforced From Recorded Attendance

The system SHALL enforce a configured weekly ceiling on overtime at claim submit. For each ISO week touched by the claim, the system SHALL sum `ot_normal_minutes`, `holiday_work_minutes`, and `ot_holiday_minutes` across every `attendance_day` in that week for that employee, and SHALL reject the submit when the total exceeds the ceiling. The total SHALL be computed from RECORDED attendance rather than from claimed hours, so that leaving hours unclaimed cannot evade the limit. The ceiling SHALL be configuration rather than a fixed constant, because the statutory figure differs between the jurisdictions this platform serves. A claim spanning a week boundary SHALL be checked against every week it touches, and all SHALL pass.

#### Scenario: A week within the ceiling is accepted

- **GIVEN** a week whose recorded overtime is below the configured ceiling
- **WHEN** a claim over days in that week is submitted
- **THEN** it is accepted

#### Scenario: A week over the ceiling is refused

- **GIVEN** a week whose recorded overtime exceeds the configured ceiling
- **WHEN** a claim over days in that week is submitted
- **THEN** it is rejected and no reservation is written

#### Scenario: Unclaimed hours still count towards the ceiling

- **GIVEN** a week with recorded overtime above the ceiling, of which only a small part is claimed
- **WHEN** that small claim is submitted
- **THEN** it is still rejected, because the ceiling is about hours worked

#### Scenario: A claim spanning two weeks is checked against both

- **GIVEN** a claim whose range crosses an ISO week boundary
- **WHEN** it is submitted
- **THEN** both weeks are checked and either failing rejects the submit

#### Scenario: The refusal identifies the week

- **WHEN** a claim is refused for exceeding the ceiling
- **THEN** the error names the week and the recorded total, so the claimant can see why

### Requirement: Overtime Is Submitted Through Its Own Endpoint

The system SHALL provide an overtime submit endpoint that owns the claim's rules and then delegates to the document engine. The overtime document type SHALL carry `derives_quantity`, so the generic submit endpoint refuses it. On submit the system SHALL re-sum the claimed days, enforce the weekly ceiling, and reserve any configured `OT_HOURS` quota from the summed hours. The quantity reserved SHALL be the quantity the system summed, never one supplied by a client.

#### Scenario: Generic submit refuses an overtime document

- **WHEN** an overtime document is submitted through the generic document submit endpoint
- **THEN** it is rejected and nothing is reserved

#### Scenario: The reserved quantity is the summed quantity

- **WHEN** an overtime claim is submitted
- **THEN** any quota reservation equals the hours summed from the projection

#### Scenario: A company without an overtime quota can still claim

- **GIVEN** a company that configures no `OT_HOURS` quota
- **WHEN** an overtime claim is submitted
- **THEN** it succeeds, because the statutory ceiling rather than a quota is what binds

### Requirement: Approving Overtime Does Not Alter Any Day

Approving an overtime claim SHALL NOT recompute, modify, or invalidate any `attendance_day` row. The minutes were recorded when they were worked, and approval decides only whether they are certified.

#### Scenario: Approval leaves the projection untouched

- **GIVEN** a computed day carrying recorded overtime
- **WHEN** a claim over it is approved
- **THEN** the day's stored values and `computed_at` are unchanged
