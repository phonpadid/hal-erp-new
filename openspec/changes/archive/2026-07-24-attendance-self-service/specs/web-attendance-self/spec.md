## ADDED Requirements

### Requirement: Punch Screen

The system SHALL provide a screen at which an employee records their own check-in and check-out, showing whether their last punch of the day was an entry or an exit, and listing the day's punches in order. The screen SHALL be usable on a phone: it SHALL NOT place the punch controls inside a horizontally scrolling table, and the primary control SHALL be reachable without scrolling on a small viewport. The screen SHALL be reachable by a user holding `ATTEND_PUNCH_SELF` and SHALL NOT require any code that grants sight of another employee's punches. Recording a punch SHALL refresh the day's punches without the screen issuing a second read of its own.

#### Scenario: Recording a check-in

- **GIVEN** an employee holding `ATTEND_PUNCH_SELF`
- **WHEN** they press check in
- **THEN** the punch is recorded and appears in the day's list

#### Scenario: The screen says which way you are facing

- **GIVEN** a day whose last punch was a check-in
- **WHEN** the screen is shown
- **THEN** it indicates the employee is currently in

#### Scenario: A second press does not create a second visible punch

- **GIVEN** a check-in just recorded
- **WHEN** the employee presses check in again within the server's duplicate window
- **THEN** the day's list still shows one check-in and the screen reports the outcome

#### Scenario: Reachable without the power to see others

- **GIVEN** a user holding `ATTEND_PUNCH_SELF` and no other attendance code
- **WHEN** they open the punch screen
- **THEN** it loads and they can punch

#### Scenario: A failed punch is reported as a toast

- **WHEN** recording a punch fails
- **THEN** the failure is shown as a toast and the screen stays usable

### Requirement: Location Is Attached When Available And Never Blocks A Punch

The system SHALL request the device's location before recording a punch, SHALL send the coordinates as decimal strings when it obtains them, and SHALL record the punch without coordinates when it does not. The screen SHALL distinguish the outcomes of the location request — obtained, denied by the user, timed out, and unavailable in this browser — and SHALL show which one occurred. A denial, a timeout, or an unavailable API SHALL NOT prevent a punch from being recorded.

#### Scenario: Coordinates are attached

- **GIVEN** a browser that grants location
- **WHEN** the employee punches
- **THEN** the punch carries latitude and longitude as decimal strings

#### Scenario: A denied permission still records the punch

- **GIVEN** an employee who refuses the location permission
- **WHEN** they punch
- **THEN** the punch is recorded without coordinates and the screen says the location was denied

#### Scenario: A timeout still records the punch

- **GIVEN** a location request that times out
- **WHEN** the employee punches
- **THEN** the punch is recorded without coordinates and the screen says the request timed out

#### Scenario: An unavailable API is reported as such

- **GIVEN** a browser with no geolocation available
- **WHEN** the screen is opened
- **THEN** it says location is unavailable rather than saying it was denied

#### Scenario: Coordinates never become JS numbers

- **WHEN** coordinates are obtained
- **THEN** they are carried as strings at every point between the device and the request body

### Requirement: My Days Read

The system SHALL provide a read-only screen listing the calling employee's own computed attendance days, showing for each day its status, expected and worked minutes, late minutes and late occurrences as two separate figures, early-leave minutes, and overtime split by kind. It SHALL be reachable by a user holding `ATTEND_DAY_SELF` and SHALL NOT require the code that lists every employee's days. The screen SHALL NOT offer any control that edits a day, because the day is derived.

#### Scenario: An employee reads their own month

- **GIVEN** a user holding `ATTEND_DAY_SELF`
- **WHEN** they open my days for a date range
- **THEN** only their own days are listed

#### Scenario: Lateness is shown as minutes and as occurrences

- **GIVEN** a month with three late days of ten minutes each
- **WHEN** it is read
- **THEN** the screen shows both the total minutes and the number of occurrences

#### Scenario: Nothing on the screen edits a day

- **WHEN** the screen is shown
- **THEN** it offers no control that writes to a day

#### Scenario: An empty month is stated, not blank

- **GIVEN** a range with no computed days
- **WHEN** it is read
- **THEN** an empty state is shown rather than an empty table

### Requirement: Leave Request With Charge Preview

The system SHALL provide a form on which an employee raises their own leave request, choosing a leave type, a date range, and a half at each end. Before the request is submitted the form SHALL show how many days it will actually charge, refreshed whenever the dates or the halves change. The form SHALL create the document, attach the leave detail, and submit it as one action from the requester's point of view, and SHALL report which step failed when one does.

#### Scenario: The charge is shown before submitting

- **GIVEN** a range spanning a public holiday
- **WHEN** the employee picks those dates
- **THEN** the form shows the charge excluding the holiday, before anything is submitted

#### Scenario: A half day at one end

- **WHEN** the employee selects a `PM` start and a `FULL` end
- **THEN** the previewed charge reflects the half day

#### Scenario: Raising leave is one action

- **WHEN** the employee submits the form
- **THEN** the document is created, the leave detail attached, and the request submitted without the employee seeing the intermediate steps

#### Scenario: A failure names the step

- **WHEN** submission fails after the document was created
- **THEN** the message says which step failed rather than reporting a generic error

#### Scenario: Client validation mirrors the server

- **WHEN** the form is filled with a `to_date` before its `from_date`
- **THEN** the form reports it without a round trip, using the same schema the server validates against

### Requirement: Time Correction Request By Picking A Punch

The system SHALL provide a form on which an employee raises a correction about their own attendance, choosing to add a punch that was never recorded, change one that was recorded at the wrong time, or remove one that should not exist. For a change or a removal the form SHALL list that shift day's correctable punches and require the requester to SELECT one, rather than to describe it by time. The form SHALL require a reason.

#### Scenario: Picking the punch to change

- **GIVEN** a shift day with two punches
- **WHEN** the employee chooses to change one
- **THEN** the form lists both and the employee selects the row

#### Scenario: Adding a punch names no target

- **WHEN** the employee chooses to add a forgotten check-out
- **THEN** the form asks for a time and direction and offers no punch to select

#### Scenario: A removal asks for no time

- **WHEN** the employee chooses to remove a duplicate punch
- **THEN** the form asks for the punch and a reason, and asks for no time

#### Scenario: A reason is always required

- **WHEN** the employee submits without a reason
- **THEN** the form rejects it

#### Scenario: A day already corrected shows only what still counts

- **GIVEN** a punch already superseded by an approved correction
- **WHEN** the correctable punches are listed
- **THEN** the superseded punch is not offered

### Requirement: Self-Service Navigation And Route Gating

The system SHALL expose the self-service attendance screens through the application's navigation and SHALL gate each route on the permission code for what that screen does: the punch screen on `ATTEND_PUNCH_SELF`, my days on `ATTEND_DAY_SELF`, and the request forms on the document-creation code. The client gate SHALL be treated as presentation only; the server SHALL remain the authority.

#### Scenario: A user without the code does not reach the screen

- **WHEN** a user without `ATTEND_PUNCH_SELF` navigates to the punch screen
- **THEN** they are redirected away from it

#### Scenario: Navigation reflects what the user can do

- **GIVEN** a user holding `ATTEND_PUNCH_SELF` but not `ATTEND_DAY_SELF`
- **WHEN** the navigation is rendered
- **THEN** the punch entry is offered and my days is not

#### Scenario: The client gate is not the enforcement

- **WHEN** a request reaches the server without the required code
- **THEN** the server rejects it regardless of what the client showed

### Requirement: Self-Service Text Is Translated In Every Locale

The system SHALL provide every string on these screens in all supported locales, and SHALL place no literal text in a view template. The application already fails its build on a key present in one locale and missing in another, and on literal text inside a view.

#### Scenario: A new key exists in every locale

- **WHEN** a string is added for these screens
- **THEN** it exists in every supported locale with the same key

#### Scenario: No literal text in a template

- **WHEN** the views are scanned
- **THEN** no view template contains a literal text node
