## ADDED Requirements

### Requirement: Notification Bell with Unread Count

The web app SHALL show a `NOTIFICATION_VIEW` user a header bell with a badge of their unread
notification count, and refresh it (on load, after acting, and on a periodic poll) so new
notifications surface without a manual reload. The count SHALL reflect the signed-in user's own
notifications only.

#### Scenario: Badge shows unread count

- **WHEN** a `NOTIFICATION_VIEW` user has unread notifications
- **THEN** the bell shows a badge with the unread count

#### Scenario: Count clears as items are read

- **WHEN** the user reads their unread notifications
- **THEN** the badge count decreases accordingly

### Requirement: Notification List and Open

The web app SHALL list the user's notifications (newest first) in a dropdown and a full inbox,
each showing its message and read state. Opening a notification SHALL mark it read and, when it
references a document, navigate to that document's detail.

#### Scenario: Opening a notification marks it read and navigates

- **WHEN** the user opens a notification that references a document
- **THEN** it is marked read and the document's detail is shown

#### Scenario: Inbox lists newest first

- **WHEN** the user opens the notification inbox
- **THEN** their notifications are listed most-recent first, with read state shown

### Requirement: Mark Read

The web app SHALL let the user mark a single notification read, and provide a mark-all-read
convenience. Read state SHALL be reflected in the list and the unread count.

#### Scenario: Mark a single notification read

- **WHEN** the user marks one notification read
- **THEN** it no longer counts as unread

### Requirement: Permission-Gated Notification Affordances

The bell and inbox SHALL be shown only to users holding `NOTIFICATION_VIEW` (UX only; the
server still enforces own-inbox access by user).

#### Scenario: Bell hidden without permission

- **WHEN** a user without `NOTIFICATION_VIEW` is signed in
- **THEN** the notification bell is not shown
