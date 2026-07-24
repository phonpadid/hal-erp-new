# Attendance-Leave Specification

## Purpose
Leave as a document that draws down an entitlement and changes what the daily projection says.
A request is stored as a range with half-day ends rather than a day count, because the projection
cannot judge a 13:00 arrival without knowing whether the morning was taken. It charges working days
only, resolved against the employee's own shift and the company holidays, so a range spanning a
public holiday costs less than its length.

Every leave-specific rule is enforced at leave's own boundary: the document type carries
`derives_quantity`, so generic submit refuses it and the owning endpoint re-counts the days,
enforces notice, backdating and the certificate threshold, and only then reserves. Approving a
leave recomputes the days it covers, after the approval has committed and without rolling it back
if that fails — a day that never caught up stays findable by comparing `computed_at` to
`approved_at`.

## Requirements
### Requirement: Leave Request Recorded As A Range With Half-Day Ends

The system SHALL store each leave document's request in a `leave_request` row carrying `document_id`, `quota_id`, `from_date`, `from_half`, `to_date`, `to_half`, and a computed `total_days`. `from_half` and `to_half` SHALL each be `FULL`, `AM`, or `PM`. `to_date` SHALL NOT precede `from_date`, and when both dates are equal the request SHALL NOT specify a half at one end that contradicts the other. The system SHALL derive the half applying to any covered date as: `from_half` on `from_date`, `to_half` on `to_date`, and `FULL` on every date between. Exactly one `leave_request` SHALL exist per leave document.

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

### Requirement: Leave Charges Working Days Only

The system SHALL count only working days towards `total_days`, resolving each date in the range against the employee's own shift and the company `holiday_calendar`. A date that is a company holiday, or a weekday the employee's shift does not work, SHALL contribute zero. A half day SHALL contribute half of that date's own expected working time, not half of a fixed day. `total_days` SHALL be the sum of those contributions and SHALL be the quantity reserved against the quota.

#### Scenario: A holiday inside the range is not charged

- **GIVEN** a Monday-to-Friday request in which Thursday is a company holiday
- **WHEN** `total_days` is computed
- **THEN** it is 4, not 5

#### Scenario: A weekend inside the range is not charged

- **GIVEN** an employee whose shift works weekdays only
- **WHEN** they request leave spanning a weekend
- **THEN** the weekend dates contribute zero

#### Scenario: A half day on a short Saturday is half of that day

- **GIVEN** a shift whose Saturday runs 08:00-12:00
- **WHEN** an employee takes a half day on that Saturday
- **THEN** the contribution is half of that Saturday's expected time, not half of a full weekday

#### Scenario: A request entirely on non-working days charges nothing

- **WHEN** a request covers only holidays and days off
- **THEN** `total_days` is zero and the request is rejected as having nothing to charge

#### Scenario: The charged quantity is what the quota reserves

- **WHEN** a leave document is submitted
- **THEN** the `quota_usage` USE row's quantity equals the computed `total_days`

### Requirement: Leave Recomputes The Days It Covers

When a leave document reaches approval the system SHALL recompute the `attendance_day` rows for every date the request covers. The recomputation SHALL run after the approval has committed and SHALL NOT roll the approval back if it fails; a failure SHALL be reported on the approval response rather than discarded. Recording a leave request that is not yet approved SHALL NOT recompute anything.

#### Scenario: Approval refreshes the covered days

- **GIVEN** an approved-pending leave request covering three working days
- **WHEN** the document is fully approved
- **THEN** those three `attendance_day` rows are recomputed and report `LEAVE`

#### Scenario: A recomputation failure does not undo the approval

- **GIVEN** a leave document being approved
- **WHEN** the subsequent recomputation fails
- **THEN** the approval stands and the failure is reported to the caller

#### Scenario: A draft leave request changes nothing

- **WHEN** a leave request is created but not submitted
- **THEN** no `attendance_day` row is recomputed

### Requirement: Stale Leave Read

The system SHALL provide a read, guarded by `ATTEND_DAY_READ`, that returns the dates covered by an approved leave whose `attendance_day` was computed before the leave was approved — that is, where the document's `approved_at` is later than the row's `computed_at`, or where no row exists. This read SHALL require no additional stored state.

#### Scenario: A day that has not caught up is listed

- **GIVEN** an approved leave whose covered day was last computed before approval
- **WHEN** the stale read runs
- **THEN** that employee and date are returned

#### Scenario: A recomputed day is not listed

- **WHEN** the day is recomputed after the approval
- **THEN** it no longer appears in the stale read

#### Scenario: Unapproved leave is not stale

- **GIVEN** a submitted but unapproved leave request
- **WHEN** the stale read runs
- **THEN** its dates are not returned, because nothing has yet been decided

### Requirement: Leave Is Submitted Through Its Own Endpoint

The system SHALL provide a leave submit endpoint that owns every leave-specific rule and then delegates to the document engine. On submit it SHALL re-count the request's working days and overwrite `total_days`, enforce the leave type's advance-notice and backdating windows, enforce the attachment threshold, build the quota reservation from the re-counted quantity, and only then submit the document. The quantity charged SHALL always be the quantity the system counted, never one supplied by a client. The leave document's type SHALL carry `derives_quantity`, so the generic submit endpoint refuses it.

The days are re-counted at submit rather than trusted from creation because a holiday may be declared or a shift reassigned in between — the same reason this system stamps `document.exchange_rate` at submit rather than at draft. The `total_days` written at creation is a preview; the one written at submit is the charge.

#### Scenario: The charged quantity is the counted quantity

- **WHEN** a leave document is submitted
- **THEN** the `quota_usage` USE row's quantity equals the freshly counted working days
- **AND** no quantity supplied by the caller is used

#### Scenario: A holiday declared after the request reduces the charge

- **GIVEN** a recorded three-day request whose middle date later becomes a company holiday
- **WHEN** the leave is submitted
- **THEN** `total_days` is re-counted to two and two days are charged

#### Scenario: Generic submit refuses a leave document

- **WHEN** a leave document is submitted through the generic document submit endpoint
- **THEN** it is rejected and no quota is reserved

#### Scenario: Leave rules are enforced before anything is reserved

- **GIVEN** a request that violates its type's advance-notice window
- **WHEN** it is submitted
- **THEN** it is rejected and no `quota_usage` row is written

### Requirement: Leave Type Configuration

The system SHALL configure each leave type in a `leave_type` record keyed one-to-one on the `quota` that represents it, carrying `advance_notice_days` (how many days before the leave starts it must be filed, default 0), `backdate_limit_days` (how many days after the leave started it may still be filed, 0 meaning backdating is not allowed), and a nullable `attachment_required_over_days` (the number of consecutive days beyond which a supporting attachment is required, null meaning never). These settings SHALL live with leave rather than on `quota`, because `quota` is a general allowance also used for overtime hours and asset bookings, to which none of these rules apply. Administering them SHALL be authorized by `LEAVE_MANAGE`.

#### Scenario: Sick leave may be reported on return

- **GIVEN** a leave type with `advance_notice_days` 0 and a non-zero `backdate_limit_days`
- **WHEN** an employee files it for dates already past, within that limit
- **THEN** the request is accepted

#### Scenario: Backdating beyond the limit is refused

- **WHEN** an employee files a backdated request older than `backdate_limit_days`
- **THEN** it is rejected

#### Scenario: Annual leave requires notice

- **GIVEN** a leave type with `advance_notice_days` 1 and `backdate_limit_days` 0
- **WHEN** an employee submits it for today
- **THEN** the request is rejected as too late

#### Scenario: A long sick leave requires its certificate

- **GIVEN** a leave type with `attachment_required_over_days` 3
- **WHEN** a request of four consecutive days is submitted with no attachment
- **THEN** it is rejected

#### Scenario: A short absence needs no certificate

- **GIVEN** the same type
- **WHEN** a two-day request is submitted with no attachment
- **THEN** it is accepted

#### Scenario: Configuration is permission-gated

- **WHEN** a request without `LEAVE_MANAGE` configures a leave type
- **THEN** it is forbidden and nothing changes
