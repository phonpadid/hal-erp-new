## MODIFIED Requirements

### Requirement: Form Template and Field Management

The web app SHALL let a `DOC_CONFIG_MANAGE` user, per document type, create a form template, add
fields and publish a template. The field editor SHALL support the full field-type set
(`text`, `number`, `date`, `dropdown`, `file`, `line_items`), let the user edit a `dropdown`
field's choices (`options_json`), set a field's show/hide rule (`condition_json`) by referencing
another field on the same template with an operator and value, and reorder fields. Published
templates are immutable in the UI; further changes create a new version, and a published template
MAY be retired. All field input SHALL be validated client-side against the shared schema.

#### Scenario: Build and publish a form

- **WHEN** the user creates a template for a type, adds fields, and publishes it
- **THEN** the template shows as published with its fields

#### Scenario: Fields are listed in order

- **WHEN** the user views a template's fields
- **THEN** they appear ordered by sort order

#### Scenario: Edit dropdown choices

- **WHEN** the user adds a `dropdown` field and enters its choices
- **THEN** the choices are saved as `options_json` and shown when the field renders

#### Scenario: Set a conditional show/hide rule

- **WHEN** the user gives a field a rule referencing another field's value
- **THEN** the rule is saved as `condition_json` for that field

#### Scenario: Add a file or line-items field

- **WHEN** the user adds a field of type `file` or `line_items`
- **THEN** the field is saved with that type and the document form will capture attachments or line rows accordingly

#### Scenario: Reorder fields

- **WHEN** the user changes a field's position
- **THEN** the new sort order is persisted and reflected in the field list
