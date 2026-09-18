## ADDED Requirements

### Requirement: An Inherited Budget Stays Selectable On A Draft

When the create wizard edits an existing draft, it SHALL request the selectable-budgets read
naming that draft, so the budgets its lines already carry are offered back. A line whose budget
came with the document SHALL NOT be reported as "budget unavailable" and SHALL NOT block the
step. Inherited budgets SHALL be shown in their own group, labelled as coming with the document,
ahead of the requester's own budgets, so the requester can tell them from budgets they may freely
choose among.

#### Scenario: Procurement completes a PO raised from ADM's PR

- **GIVEN** a PO draft created from an ADM PR, carrying ADM's budget on its line, opened by a Procurement user whose own picker does not offer that budget
- **WHEN** the line editor renders
- **THEN** the line shows ADM's budget selected, no "unavailable" message, and the step may proceed

#### Scenario: Inherited budgets are grouped and labelled

- **WHEN** the picker offers an inherited budget
- **THEN** it appears under a group labelled as coming with the document, before the requester's own groups

#### Scenario: A new draft asks for nothing extra

- **WHEN** the wizard creates a new document rather than editing one
- **THEN** the selectable-budgets read is requested without a document id
