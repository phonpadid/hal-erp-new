# web-documents

## ADDED Requirements

### Requirement: A Date Field Keeps What Was Typed Or Says It Did Not

A date field SHALL accept a typed date as well as one chosen from its calendar. A typed value that
parses SHALL be kept. A typed value that does not parse SHALL be reported to the user: the control
SHALL be marked invalid AND SHALL name the format it accepts.

Silently discarding it is the failure to remove. A field that takes keystrokes, displays them, and
then throws them away gives the user no reason to look again: a promotion submitted this way carried
no effective date at all, the review step showed only a dash, and nothing at any stage said the date
had been dropped.

The requirement is that the rejection is *reported*, not that the text survives. The date control
clears its own box on input it cannot parse and that is not preventable from outside it, which is
exactly why a marker alone is not enough — a red border around a box that just emptied itself
explains nothing. The message is what carries the meaning.

The stored value SHALL remain the ISO `yyyy-mm-dd` string the rest of the form expects, and the
format a user may type SHALL be the format the field displays, so what is shown and what is accepted
agree.

#### Scenario: A typed date is kept

- **WHEN** a user types a date into a date field and moves on
- **THEN** the value is carried into the review step and stored

#### Scenario: An unparseable date is refused visibly

- **WHEN** a user types something that is not a date
- **THEN** the field is marked invalid and shows the format it accepts, rather than emptying itself
  with no explanation

#### Scenario: The calendar still works

- **WHEN** a user picks a date from the calendar
- **THEN** the value is stored as before

### Requirement: The Review Step Shows a Missing Required Value As Missing

The wizard's review step SHALL distinguish a field left empty from a field whose value it cannot
show. Where a required field has no value, the review SHALL mark it as missing rather than rendering
a placeholder that reads like a legitimate blank.

The review step is the last screen before a document becomes somebody else's work, and a dash in a
column is not a warning. The promotion that lost its effective date showed exactly the same dash a
genuinely optional empty field shows.

#### Scenario: A missing required value is marked

- **GIVEN** a document whose required date field has no value
- **WHEN** the review step renders
- **THEN** that field is marked as missing rather than shown as an ordinary blank

#### Scenario: An optional empty field is not marked

- **GIVEN** a document whose optional field is empty
- **WHEN** the review step renders
- **THEN** it is shown as blank without a warning
