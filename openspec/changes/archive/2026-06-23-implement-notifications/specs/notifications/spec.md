## ADDED Requirements

### Requirement: Multi-Channel Dispatch

The system SHALL dispatch a notification through the channel named on its template (or
request): an IN_APP notification is delivered by persisting the `notification` row; an
EMAIL notification is sent via SMTP. A notification row SHALL start `PENDING` and move to
`SENT` (with `sent_at`) on successful dispatch or `FAILED` on error. Unsupported channels
(LINE / SMS) SHALL be recorded without erroring until a transport is added.

#### Scenario: In-app dispatch records a sent notification

- **WHEN** an IN_APP notification is dispatched for a user
- **THEN** a `notification` row is created for that user with `status = SENT` and `sent_at` set

#### Scenario: Failed send is recorded, not lost

- **WHEN** a dispatch's transport throws
- **THEN** the row is retained with `status = FAILED` (re-sendable later)

### Requirement: Read Tracking and Caller-Scoped Retrieval

A user SHALL retrieve only their own notifications (optionally filtered to unread), and
SHALL mark one read, setting `is_read = true` and `read_at`. Listing and reads are scoped
to the active company.

#### Scenario: Mark a notification read

- **WHEN** the recipient opens a notification
- **THEN** its `is_read` becomes true and `read_at` is set

#### Scenario: Unread filter returns only unread

- **GIVEN** a user with one read and one unread notification
- **WHEN** they list with the unread filter
- **THEN** only the unread notification is returned

### Requirement: Event-Driven and SLA Notifications

When a document enters an approver's step the system SHALL generate a pending-approval
notification for each eligible approver; on a terminal outcome (approved / rejected /
returned) it SHALL notify the requester. The system SHALL also scan `IN_APPROVAL`
documents whose current step has exceeded its working-hour SLA and notify/escalate.

#### Scenario: Step assignment notifies the approver

- **WHEN** a document enters a step assigned to an approver
- **THEN** a notification is generated for that approver

#### Scenario: SLA-overdue scan notifies

- **GIVEN** an `IN_APPROVAL` document whose current step is past its `sla_hours`
- **WHEN** the SLA scan runs
- **THEN** an overdue notification is generated for the pending approver(s)
