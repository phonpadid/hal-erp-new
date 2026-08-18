# document-engine

## ADDED Requirements

### Requirement: A Field's Type Declares the Shape of Its Stored Value

`form_field.field_type` SHALL determine both the control the form renders and the shape of the value
stored in `doc_field_value`, and those two SHALL agree.

Only the rich-text types store markup. A field of any other type SHALL store the value itself: a
`number` stores a decimal string, a `date` stores an ISO `yyyy-mm-dd` string, a `dropdown` stores the
chosen option's value, and a `string` stores a single line of plain text. Writing a value that
carries markup to a field of one of those types SHALL be rejected.

The rule exists because a field type read as "which editor" and a field type read as "what the value
is" can disagree without anything failing until much later. A salary configured as a rich-text field
is stored as `<p>7500000</p>`, which no consumer parsing a decimal can accept — and the failure
surfaces at approval, in a post-action, to a person who did not fill the form in.

Where a post-action or any other consumer parses a field's value, the field's type SHALL be one whose
stored value can be parsed. Choosing a type whose control is convenient over one whose value is
correct is what this forbids.

#### Scenario: A numeric field stores a number

- **GIVEN** a form field whose type is `number`
- **WHEN** a document of that type is saved with a value entered in it
- **THEN** the stored value is a decimal string carrying no markup

#### Scenario: Markup in a non-rich field is rejected

- **WHEN** a value carrying markup is written to a field whose type is not a rich-text type
- **THEN** the write is rejected, naming the field

#### Scenario: A rich-text field may still store markup

- **GIVEN** a form field whose type is a rich-text type
- **WHEN** a value with formatting is saved
- **THEN** the markup is stored as entered

#### Scenario: A promotion's salary reaches its post-action parseable

- **GIVEN** a promotion document whose salary field was filled in through the form
- **WHEN** the document is fully approved
- **THEN** the post-action's salary guard accepts the value and the employee is updated

### Requirement: A Job Level Is Chosen From the Levels That Exist

A form field that carries an employee's job level SHALL offer the active company's `job_level`
records as its options rather than accepting free text.

`employee.job_level` is what the approval router compares against a step's minimum rank. A level
typed by hand that matches no configured level produces an employee the router cannot place, and the
document that set it looks no different from one that set a real level.

#### Scenario: The level comes from master data

- **WHEN** a promotion form renders its job-level field
- **THEN** the options are the active company's job levels

#### Scenario: A level that does not exist cannot be set

- **WHEN** a job level outside the company's configured levels is submitted
- **THEN** the submit is rejected
