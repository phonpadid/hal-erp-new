# platform-foundation

## MODIFIED Requirements

### Requirement: DTO validation and UUID parsing

Every request body SHALL be validated with class-validator (whitelist + forbid non-whitelisted), including a body that arrives as a top-level array, and every UUID route parameter SHALL be parsed/validated with `ParseUUIDPipe`.

The global `ValidationPipe` treats a top-level array as a native type and does not validate it, so an endpoint whose body is an array SHALL declare the element class explicitly, with the same whitelist and forbid-non-whitelisted settings as the global pipe. The same element class SHALL therefore be enforced identically whether it arrives nested inside another DTO or as the whole body — a rule that holds on create and not on update is a rule the caller cannot rely on.

#### Scenario: Invalid payload is rejected

- **WHEN** a request body fails its DTO validation rules
- **THEN** the request is rejected with 400 and a structured validation error

#### Scenario: Malformed UUID is rejected

- **WHEN** a route parameter typed as a UUID receives a non-UUID value
- **THEN** the request is rejected with 400 before reaching the handler

#### Scenario: An element of an array body is missing a required field

- **GIVEN** an endpoint whose body is an array of a validated element class
- **WHEN** one element omits a field that class requires
- **THEN** the request is rejected with 400 naming the field, and nothing is written

#### Scenario: An element of an array body carries an unknown field

- **GIVEN** an endpoint whose body is an array of a validated element class
- **WHEN** one element carries a field the class does not declare
- **THEN** the request is rejected with 400, as it would be for the same field on a non-array body

#### Scenario: The body is not an array at all

- **GIVEN** an endpoint whose body is an array
- **WHEN** the caller sends something that is not one
- **THEN** the request is rejected with 400 before reaching the handler

## ADDED Requirements

### Requirement: A Refusal From Below The DTO Layer Is Not Reported As A Server Fault

A data-validation failure raised by the persistence layer SHALL be answered as a problem with the request — 400, carrying the validation code — and SHALL NOT be answered as an internal server error.

Not every bad payload is stopped by DTO validation: a value can pass its decorators and still be refused when the entity is built. Reporting that as a server fault tells the caller the opposite of the truth, and the code it carries is the one an integration is told to retry or escalate on, so the misattribution costs the caller a wrong action rather than only a wrong word.

The response body SHALL keep the shape every other error has — `statusCode`, `message`, `error`, `code` — and its `message` SHALL name what was missing or wrong, because a 400 that does not say which field is no more actionable than the 500 it replaces.

Such a failure SHALL still be recorded in the server log, because the same shape can also mean the system itself failed to set a required value, and after this rule the response alone no longer distinguishes the two. Genuine faults SHALL continue to answer 500 with a message that reveals nothing.

#### Scenario: A payload the DTO layer let through is refused when the row is built

- **WHEN** a request reaches the persistence layer and is refused there for a missing or invalid value
- **THEN** the response is 400 with the validation code, and names the value

#### Scenario: The caller is not told to escalate

- **WHEN** such a refusal is answered
- **THEN** the response does not carry the internal-error code

#### Scenario: A genuine fault is unchanged

- **WHEN** an error that is not a data-validation failure escapes a handler
- **THEN** the response is still 500 with the internal-error code and a message that reveals nothing, and the fault is logged

#### Scenario: The misattributed case stays visible

- **WHEN** such a refusal is answered as 400
- **THEN** it is still recorded in the server log, so a failure the system itself caused is not hidden by the status it now returns
