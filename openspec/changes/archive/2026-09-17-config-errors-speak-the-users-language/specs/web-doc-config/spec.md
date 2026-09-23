## ADDED Requirements

### Requirement: A Refused Configuration Write Is Explained In The Reader's Language

The web app SHALL render every refusal a configuration screen shows — for a document type, a category, a form template or
field, a department mapping, a reference pairing, a workflow, a step or a delegation — from the server's message key through i18n, in en, la and zh, with the facts the server
sent (`typeCode`, `stepNo`, `status`, a category or workflow code) substituted in. The sentence
SHALL say what was refused and what to do about it, in the words of the screen — "post-action",
"ต้องใช้งบ"/"ຕ້ອງໃຊ້ງົບ", "pairing" — and SHALL NOT show a database id. A refusal the client has no
translation for SHALL show the server's English message rather than nothing.

The active-state switch on the document-type list SHALL, on a refusal, revert to the stored value
and show the refusal beside the row it belongs to, so the reader is not left with a switch that
says one thing and a database that says another. A refused ACTION on any configuration screen —
a toggle, a save, a delete — SHALL be reported as a toast and SHALL leave the list standing; it
SHALL NOT replace the content region with the page-load error state, which is for a read that
failed (web-app-layout, *Action Feedback and Confirmation*).

#### Scenario: The settle refusal reads in Lao

- **GIVEN** the interface language is Lao
- **WHEN** activating a type is refused because `CLAIM_RECOVERY` would be left reserving budget with
  no settlement
- **THEN** the toast reads, in Lao, that `CLAIM_RECOVERY` reserves budget with no way to settle it
  and names the two repairs (a settling post-action, or a pairing to a type that settles)

#### Scenario: A step that names nobody is explained by its number

- **WHEN** saving a workflow step with neither a role nor a person is refused
- **THEN** the toast names the step number and says an approver role or person is required, in the
  interface language

#### Scenario: A not-found never shows an id

- **WHEN** a configuration write is refused because its target no longer exists
- **THEN** the toast says the thing (the workflow, the mapping, the template) was not found, without
  a UUID

#### Scenario: The switch does not lie after a refusal

- **WHEN** toggling a document type's active switch is refused
- **THEN** the switch shows the stored value again, the refusal is toasted, and the list of types
  is still on screen — not replaced by an error panel with a retry button
