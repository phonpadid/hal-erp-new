## ADDED Requirements

### Requirement: The Document Type Form Chooses The Printed Sheets

The document-type admin form SHALL let a `DOC_CONFIG_MANAGE` user choose the type's
`print_templates` from the closed set — official letter (ໃບສະເໜີ), purchase request (PR),
purchase order (PO) and receipt (ໃບເບີກຈ່າຍ) — presented as named choices rather than raw codes,
allowing several to be chosen, and defaulting to the official letter alone for a new type. The form SHALL show the type's stored value when
editing and SHALL send it on save. The choice SHALL be labelled so it is clear it affects only
what the document prints, not how it is routed or approved.

#### Scenario: Choosing the sheet a type prints

- **GIVEN** a `DOC_CONFIG_MANAGE` user editing a purchase-request type
- **WHEN** they choose the purchase-request sheet and save
- **THEN** the type is stored with `print_templates = PR` and documents of that type print that
  sheet

#### Scenario: Choosing both the letter and a form

- **WHEN** the user chooses the official letter and the purchase-request sheet and saves
- **THEN** both are stored, and a document of that type prints the letter followed by the form

#### Scenario: A new type defaults to the official letter

- **WHEN** the user opens the form to create a document type
- **THEN** the official letter is preselected

#### Scenario: The stored choice is shown when editing

- **GIVEN** a type stored with `print_templates = RECEIPT`
- **WHEN** the user opens it for editing
- **THEN** the receipt sheet is the selected choice
