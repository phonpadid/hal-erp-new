## ADDED Requirements

### Requirement: A Draft's Completeness Prompt Reads Each Field Where Its Value Lives

The draft-completeness prompt on a document SHALL determine whether a required field has a value by
reading where that field's TYPE stores its value, not by assuming every field stores it in
`doc_field_value`.

A `file` field's value is a `document_attachment` row. A `line_items` field's value is a
`document_line` row. Neither ever produces a `doc_field_value`, so a prompt that consults only that
table reports both as missing on every draft, whether or not the file was uploaded and the lines
were entered.

The server's submit gate already resolves presence per field type, and the prompt exists to predict
that gate's verdict. Where the two can disagree, they SHALL be driven from one shared rule rather
than from two hand-kept copies, so a field type added later cannot be handled in one and forgotten
in the other.

#### Scenario: An attached file is not reported missing

- **GIVEN** an editable draft whose template has a required `file` field, and an attachment uploaded
  against it
- **WHEN** the document detail renders
- **THEN** no completeness prompt names that field

#### Scenario: A genuinely missing file is reported

- **GIVEN** an editable draft whose template has a required `file` field and no attachment
- **WHEN** the document detail renders
- **THEN** the completeness prompt names that field

#### Scenario: Entered lines are not reported missing

- **GIVEN** an editable draft whose template has a required `line_items` field and at least one line
- **WHEN** the document detail renders
- **THEN** no completeness prompt names that field

#### Scenario: The prompt agrees with the submit gate

- **GIVEN** any editable draft
- **WHEN** the completeness prompt reports no missing field
- **THEN** the server's submit gate does not refuse the document for a missing required field

### Requirement: The Reason A Submit Was Refused Stays Readable

When a submit is refused, the screen SHALL keep the server's reason available for as long as the
document is still refused, and SHALL NOT leave a different, contradictory instruction as the only
message on screen.

A refusal delivered solely as a transient toast is gone in seconds, while a standing banner beside
it is not. A requester who looks away is then left with whatever the banner says — and acts on that
instead. Refusing an over-budget submit while the only visible text tells the reader to attach a
file they already attached sends them to fix the wrong thing and gives them no way back to the real
reason.

Where the refusal is one the requester can act on — an amount over its ceiling, a missing value, a
rate that does not resolve — the reason SHALL name what was wrong.

#### Scenario: An over-budget refusal is still readable afterwards

- **GIVEN** a draft whose amount exceeds its budget's ceiling
- **WHEN** the requester submits it and then waits
- **THEN** the reason the submit was refused is still on screen

#### Scenario: No contradictory instruction is left standing

- **WHEN** a submit is refused for a reason unrelated to missing fields
- **THEN** no completeness prompt claims a field is missing that is not
