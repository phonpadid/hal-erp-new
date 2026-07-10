## ADDED Requirements

### Requirement: Draft Detail Prompts for Missing Required Fields

The document Detail view SHALL, for a DRAFT document the signed-in user may edit, detect visible required form fields whose value is empty and surface them as an inline notice. The notice MUST list the missing fields by their form-field label and MUST offer a single action that opens the edit wizard for the document landed on the fields (Details) step. The notice MUST NOT appear when the document is not a draft, when the user lacks edit permission, or when every visible required field already has a value. Field visibility MUST be evaluated with the same conditional-visibility rules used elsewhere, so a hidden field is never reported as missing. This is a client-side convenience only; the server submit gate remains the authoritative enforcement of required fields.

#### Scenario: Draft with an empty required field shows the prompt
- **WHEN** a user who may edit opens the Detail of a DRAFT document whose visible required field `reason` is empty
- **THEN** an inline notice is shown listing `Reason` as a missing required field, with an action to complete it

#### Scenario: Prompt lists only visible required fields
- **WHEN** a DRAFT document has a required field that is hidden by its condition and another visible required field that is empty
- **THEN** the notice lists only the visible empty required field and omits the hidden one

#### Scenario: No prompt when required fields are filled
- **WHEN** a user opens the Detail of a DRAFT document whose visible required fields all have values
- **THEN** no missing-required-fields notice is shown

#### Scenario: No prompt on a non-draft or without edit permission
- **WHEN** the document is not a draft, or the user lacks permission to edit it
- **THEN** no missing-required-fields notice is shown regardless of field values

### Requirement: Edit Wizard Opens on a Requested Step

The create/edit document wizard SHALL support opening on a caller-specified step supplied through the route, and MUST fall back to the first step when none is specified or the value does not match a known step. When opened on the Details step for a draft with missing required fields, the wizard SHOULD move focus to the first empty required field so the user can complete it immediately.

#### Scenario: Deep link lands on the Details step
- **WHEN** the edit wizard is opened for a draft with a route request to start on the Details step
- **THEN** the wizard is shown with the Details step active rather than the first step

#### Scenario: Unknown or absent step falls back to the first step
- **WHEN** the edit wizard is opened with no step request, or with a step value that matches no wizard step
- **THEN** the wizard is shown with its first step active

#### Scenario: Focus lands on the first empty required field
- **WHEN** the edit wizard opens on the Details step for a draft whose required field `reason` is empty
- **THEN** input focus is placed on the `reason` field
