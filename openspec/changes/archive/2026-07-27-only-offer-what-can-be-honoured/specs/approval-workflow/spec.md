## ADDED Requirements

### Requirement: A Document No Step Applies To Is Reported, Not Silently Left

When a submitted document is routed and no workflow step applies to it, the system SHALL report the condition at a severity that is visible by default, identifying the document, stating that the budget it reserved remains held, and stating what must be corrected.

Such a document is stranded: it remains SUBMITTED, no approver is ever notified of it, and nothing in the system will pick it up. It SHALL NOT be reported at a diagnostic severity, and SHALL NOT share an outcome with conditions that are harmless.

A document whose routing has already begun SHALL NOT be reported this way — it is moving, and nothing is wrong with it.

Reporting SHALL NOT propagate the failure: routing runs after the submit has committed, so raising here would not undo the submit and would only obscure the report.

#### Scenario: A stranded document is reported

- **GIVEN** a submitted document whose workflow has no applicable step
- **WHEN** routing is attempted
- **THEN** the condition is reported at error severity, naming the document

#### Scenario: The report says what is wrong and what to do

- **GIVEN** a submitted document whose workflow has no applicable step
- **WHEN** the condition is reported
- **THEN** the report states that reserved budget is being held and what must be corrected

#### Scenario: An already-routed document is not reported as stranded

- **GIVEN** a document whose routing has already begun
- **WHEN** routing is attempted again
- **THEN** nothing is reported at error severity

#### Scenario: The failure does not escape

- **GIVEN** a submitted document whose workflow has no applicable step
- **WHEN** routing is attempted
- **THEN** no error is raised to the caller
