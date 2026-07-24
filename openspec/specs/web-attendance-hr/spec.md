# web-attendance-hr Specification

## Purpose
The HR-facing half of attendance: the Vue screens touched by the people who run attendance for
everybody else — the period workflow on which a range is declared, closed and reopened, the team
view of every employee's computed days and the recomputation that makes them current, the punch
ledger on which anyone's punches are read and a punch is entered on somebody's behalf, and the
period detail reporting what closing froze.

Every screen here acts on another person's attendance, so each is gated on a code that grants
sight of somebody else, never on a self code, and the powers that end an argument are kept apart
from the reads that lead to them: closing is not reopening, reading the ledger is not writing to
it. Closing states what it is about to summarise, because a period closed over a range nobody
computed reports zeroes that read as facts; the two figures — employee-days never computed and
employee-days overtaken by a later punch — are shown apart because they are different kinds of
unfinished work, and neither of them prevents the close. Rules the server owns are not
reimplemented on the client: a recomputation reaching into a closed period is refused by the
server and the server's message is what the screen shows. The client gate is presentation only,
figures that mean different things — late minutes against late occurrences, overtime by kind —
are never collapsed into one, and every string exists in all supported locales.

## Requirements

### Requirement: Period Workflow Screen

The system SHALL provide a screen on which an `ATTEND_PERIOD_READ` user sees the company's attendance periods with their dates and status, and on which the actions each period allows are offered according to the code they require: declaring and editing a draft under `ATTEND_PERIOD_MANAGE`, closing under `ATTEND_PERIOD_CLOSE`, and reopening under `ATTEND_PERIOD_REOPEN`. Reopening SHALL require a reason to be entered before it is sent. A control the user's codes do not permit SHALL NOT be offered, and the client gate SHALL be presentation only.

#### Scenario: Reading the periods

- **WHEN** an `ATTEND_PERIOD_READ` user opens the screen
- **THEN** the company's periods are listed with their dates and status

#### Scenario: Closing is offered only to those who may close

- **GIVEN** a user holding `ATTEND_PERIOD_READ` but not `ATTEND_PERIOD_CLOSE`
- **WHEN** they open the screen
- **THEN** no close control is offered

#### Scenario: Reopening is offered separately from closing

- **GIVEN** a user holding `ATTEND_PERIOD_CLOSE` but not `ATTEND_PERIOD_REOPEN`
- **WHEN** they view a closed period
- **THEN** no reopen control is offered

#### Scenario: Reopening asks why

- **WHEN** a user reopens a closed period
- **THEN** they are asked for a reason and it is sent with the request

#### Scenario: Declaring a period

- **WHEN** an `ATTEND_PERIOD_MANAGE` user declares a period with a code and two dates
- **THEN** it appears in the list as a draft

#### Scenario: An overlapping period is reported, not swallowed

- **WHEN** a declared period overlaps an existing one
- **THEN** the server's refusal is shown, naming the period it clashes with

### Requirement: Closing States What It Is About To Summarise

The system SHALL show, before a period is closed, how many employee-days in its range have no computed row and how many were computed before the last punch belonging to them. The confirmation SHALL state both figures rather than a single total, because one is work never done and the other is work overtaken. The screen SHALL offer to recompute the range first. Closing SHALL remain possible whatever the figures say.

#### Scenario: Closing a range nobody computed warns first

- **GIVEN** a period whose range has no computed days
- **WHEN** the user presses close
- **THEN** the confirmation states how many employee-days are missing before they confirm

#### Scenario: The two figures are shown apart

- **GIVEN** a period with both missing and stale employee-days
- **WHEN** the confirmation is shown
- **THEN** the missing count and the stale count are stated separately

#### Scenario: A current period says so

- **GIVEN** a period whose range is fully computed and current
- **WHEN** the user presses close
- **THEN** the confirmation reports nothing missing and nothing stale

#### Scenario: The user may close anyway

- **GIVEN** a warning that the range was never computed
- **WHEN** the user confirms
- **THEN** the period closes

#### Scenario: Recomputing first is offered

- **WHEN** the coverage figures are not both zero
- **THEN** the screen offers to recompute the range before closing

### Requirement: Period Detail Screen

The system SHALL provide a screen showing one period's per-employee lines with their leave days by type, its append-only close and reopen log with who acted and why, and the punches that landed inside the closed range. Late minutes and late occurrences SHALL be shown as two figures, and overtime SHALL be shown split by kind, never as one total. The screen SHALL offer no control that edits a line, because a line is produced by closing and replaced by re-closing.

#### Scenario: Reading a closed period's lines

- **WHEN** an `ATTEND_PERIOD_READ` user opens a closed period
- **THEN** one line per employee is shown with its figures

#### Scenario: Leave is shown by type

- **GIVEN** a line whose employee took two kinds of leave
- **WHEN** the line is read
- **THEN** the days are shown per type rather than as one number

#### Scenario: The log says who and why

- **GIVEN** a period that was closed, reopened and closed again
- **WHEN** its log is shown
- **THEN** all three actions appear with their actor, instant, and the reopen's reason

#### Scenario: Punches that changed nothing are visible

- **GIVEN** a punch recorded for a date inside the closed period
- **WHEN** the screen is shown
- **THEN** that punch is listed as having landed inside a closed range

#### Scenario: No control edits a line

- **WHEN** the screen is shown
- **THEN** it offers no control that writes to a line

### Requirement: Team Attendance Screen

The system SHALL provide a screen on which an `ATTEND_DAY_READ` user reads every employee's computed days, filtered by employee, date range and status, and on which an `ATTEND_DAY_RECOMPUTE` user rebuilds them for one employee or for the whole company over a range. The screen SHALL surface approved leave whose days have not caught up, as work outstanding rather than as an endpoint nobody calls. A recomputation that the server refuses because a date is inside a closed period SHALL show the server's message, and the screen SHALL NOT reimplement that rule.

#### Scenario: Reading the whole team

- **WHEN** an `ATTEND_DAY_READ` user opens the screen
- **THEN** every employee's days for the chosen range are listed

#### Scenario: Recompute is offered only to those who may

- **GIVEN** a user holding `ATTEND_DAY_READ` but not `ATTEND_DAY_RECOMPUTE`
- **WHEN** they open the screen
- **THEN** no recompute control is offered

#### Scenario: Recomputing a company over a range

- **WHEN** an `ATTEND_DAY_RECOMPUTE` user recomputes the company across a date range
- **THEN** the request covers the whole range and reports how many employee-days were written

#### Scenario: A closed date is refused by the server, not hidden by the client

- **GIVEN** a range that falls inside a closed period
- **WHEN** a recomputation is requested
- **THEN** the server's message naming the period is shown

#### Scenario: Stale leave is visible as outstanding work

- **GIVEN** approved leave whose days were computed before it was approved
- **WHEN** the screen is shown
- **THEN** those employee-days are listed as needing recomputation

### Requirement: Punch Ledger And On-Behalf Entry

The system SHALL provide a screen on which an `ATTEND_PUNCH_READ` user reads every employee's punches, and on which an `ATTEND_PUNCH_MANAGE` user records a punch for one employee or the same instant and direction for several. A bulk entry SHALL be confirmed before it is sent, stating how many employees and which instant. The screen SHALL show each punch's source and geofence status, so a hand-entered row is distinguishable from a scanned one.

#### Scenario: Reading everyone's punches

- **WHEN** an `ATTEND_PUNCH_READ` user opens the screen
- **THEN** the company's punches are listed with their source and geofence status

#### Scenario: Entering a punch on behalf needs the stronger code

- **GIVEN** a user holding `ATTEND_PUNCH_READ` but not `ATTEND_PUNCH_MANAGE`
- **WHEN** they open the screen
- **THEN** no control that records a punch is offered

#### Scenario: A bulk entry is confirmed first

- **WHEN** a user records one instant for several employees
- **THEN** they confirm a message naming the number of employees and the instant

#### Scenario: A hand-entered punch is distinguishable

- **GIVEN** a punch entered on somebody's behalf
- **WHEN** the ledger is read
- **THEN** its source shows it was entered by hand rather than scanned

### Requirement: Correcting Somebody Else's Punch Starts From The Punch

The system SHALL let an `ATTEND_PUNCH_READ` user raise a correction about another employee from that employee's punch, and the document it creates SHALL name that employee as its related employee. The correction request SHALL NOT carry a subject of its own — whose attendance is corrected is resolved from the document — so that filing on somebody's behalf is visible to every approver. The self-service correction form SHALL NOT gain a control that chooses whose attendance it is about.

#### Scenario: Raising a correction from a colleague's punch

- **GIVEN** a punch belonging to another employee
- **WHEN** an `ATTEND_PUNCH_READ` user raises a correction from it
- **THEN** the document names that employee as its related employee

#### Scenario: The subject rides on the document

- **WHEN** the correction is stored
- **THEN** its employee is the document's related employee, not a value from the request body

#### Scenario: Self-service keeps no subject picker

- **WHEN** the self-service correction form is shown
- **THEN** it offers no control naming another employee

### Requirement: HR Screens Are Gated, Navigable And Translated

The system SHALL expose these screens through the application's navigation, gate each route on the code for the read it performs, and provide every string in all supported locales with no literal text in a view template. The client gate SHALL be presentation only; the server SHALL remain the authority.

#### Scenario: A user without the read code does not reach the screen

- **WHEN** a user without `ATTEND_PERIOD_READ` navigates to the period screen
- **THEN** they are redirected away from it

#### Scenario: Navigation reflects what the user can read

- **GIVEN** a user holding `ATTEND_PERIOD_READ` and not `ATTEND_PUNCH_READ`
- **WHEN** the navigation is rendered
- **THEN** the period entry is offered and the punch ledger is not

#### Scenario: Every string exists in every locale

- **WHEN** a string is added for these screens
- **THEN** it exists in every supported locale under the same key

#### Scenario: No literal text in a template

- **WHEN** the views are scanned
- **THEN** no view template contains a literal text node
