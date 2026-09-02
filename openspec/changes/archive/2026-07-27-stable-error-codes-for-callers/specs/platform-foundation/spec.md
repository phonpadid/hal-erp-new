## ADDED Requirements

### Requirement: Every error response carries a stable code

Every error response SHALL carry a `code` field naming the failure in a form a machine can branch on, alongside the existing `statusCode`, `message` and `error` fields, whose shape and meaning SHALL be unchanged. `message` SHALL remain the human-readable text — a string, or the array the DTO validator produces — because it is what the web app displays. A caller SHALL never have to read `message` to decide what to do.

The `code` SHALL be stable: it SHALL NOT change when the message is reworded. An exception that names no code SHALL receive one derived from its HTTP status, so that a response is never without one and existing throw sites need no edit.

#### Scenario: A coded failure names itself

- **WHEN** an operation fails for a reason a caller must act on
- **THEN** the response carries the `code` for that reason, and its `message` still describes the failure in English

#### Scenario: An uncoded failure still carries a code

- **WHEN** an exception that names no code is thrown
- **THEN** the response carries a code derived from the HTTP status, and every other field of the body is exactly what it was before this requirement existed

#### Scenario: The validator's array survives

- **WHEN** a request fails DTO validation
- **THEN** `message` is still the array of validation strings the web app joins for display, and the response additionally carries the validation code

### Requirement: Codes name the situations a caller acts on differently

The named codes SHALL be chosen by what a caller does in response, not by what can throw. The system SHALL distinguish at least: a budget that refused a reservation, a quota that refused one, an operation that does not apply to the document's current state, and a payload that failed validation. Each of these SHALL be raised where the decision is made, so that any caller of that path receives it — including paths written later.

A code SHALL NOT be added for a failure nobody branches on; a generic derived code is the correct answer there, and MAY change.

#### Scenario: A hard-stop budget refuses a reservation

- **GIVEN** a document whose submit would exceed a `HARD_STOP` budget
- **WHEN** it is submitted
- **THEN** the response names the budget-exceeded code, and nothing is reserved

#### Scenario: A hard-stop quota refuses a reservation

- **WHEN** a submit would exceed a `HARD_STOP` quota
- **THEN** the response names the quota-exceeded code, distinctly from the budget one, because what has to be topped up is different

#### Scenario: The document is in the wrong state

- **WHEN** an operation is attempted on a document whose status does not permit it
- **THEN** the response names the invalid-state code, so a caller can stop rather than retry

#### Scenario: The same refusal from a path added later

- **GIVEN** a new endpoint that reserves budget through the existing ledger
- **WHEN** its reservation is refused by a hard stop
- **THEN** it returns the budget-exceeded code without that endpoint having done anything to opt in
