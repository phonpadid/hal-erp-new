## ADDED Requirements

### Requirement: Year-End Readiness View and Banner

The organization admin area SHALL show, to a user holding `FISCAL_YEAR_MANAGE`, `BUDGET_MANAGE` or
`QUOTA_MANAGE`, a readiness view for the next fiscal year listing each item from the readiness read
as done or missing (fiscal year, active budgets, quota entitlements, optional budget rate) with a
link to the screen that fixes it, and the days remaining. From 30 days before the current year ends
until the read reports ready, the app shell SHALL show such users a dismissible-for-the-day banner
linking to that view. Users without those codes SHALL see neither.

#### Scenario: Banner inside the window

- **WHEN** a `BUDGET_MANAGE` user signs in on 2026-12-10 and 2027 is not ready
- **THEN** the shell shows the readiness banner with the days remaining, linking to the view

#### Scenario: No banner once ready

- **WHEN** the readiness read reports ready
- **THEN** no banner is shown

### Requirement: Fiscal Year Overlap Is Explained

The fiscal-years page SHALL show the server's overlap refusal as its translated message and SHALL
leave the list unchanged. The existing fiscal-year Close control SHALL remain available to
`FISCAL_YEAR_MANAGE` users as before.

#### Scenario: Overlap is explained

- **WHEN** the user creates a fiscal year overlapping another
- **THEN** the translated overlap message is shown and nothing is created

#### Scenario: Close stays available

- **WHEN** a `FISCAL_YEAR_MANAGE` user views an open fiscal year
- **THEN** the Close control is offered, with its existing confirmation
